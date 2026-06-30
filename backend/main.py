import asyncio
import base64
import logging
import os
import shlex
import shutil
import stat
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Optional

import docker
import paramiko
from docker.errors import APIError, ImageNotFound, NotFound
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import load_application_config
from services import (
    ApplicationAggregationService,
    ApplicationDiscoveryService,
    ApplicationRegistry,
    ContainerAssociationService,
    DockerService,
    DomainDiscoveryService,
    GitMetadataService,
)

app = FastAPI()
client = docker.DockerClient(base_url="unix://var/run/docker.sock")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dumbdocker.app-scanner")

docker_service = DockerService(client)
git_metadata_service = GitMetadataService()
app_discovery_service = ApplicationDiscoveryService(git_metadata_service)
association_service = ContainerAssociationService()
aggregation_service = ApplicationAggregationService()
domain_discovery_service = DomainDiscoveryService()
application_registry = ApplicationRegistry()
app_config = load_application_config()

scan_task = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class VpsConnectionPayload(BaseModel):
    host: str
    username: str
    port: int = 22
    password: Optional[str] = None
    private_key: Optional[str] = None
    private_key_passphrase: Optional[str] = None


class VpsListFilesPayload(VpsConnectionPayload):
    path: str


class VpsReadFilePayload(VpsConnectionPayload):
    path: str


class VpsWriteFilePayload(VpsConnectionPayload):
    path: str
    content: str


class VpsDeletePathPayload(VpsConnectionPayload):
    path: str


class VpsCreateDirectoryPayload(VpsConnectionPayload):
    path: str


class VpsRunCommandPayload(VpsConnectionPayload):
    command: str
    cwd: Optional[str] = None


class VpsUploadFilePayload(VpsConnectionPayload):
    path: str  # destination directory
    filename: str
    content_base64: str


class VpsDownloadFilePayload(VpsConnectionPayload):
    path: str


class VpsRenamePayload(VpsConnectionPayload):
    path: str
    new_path: str


def _load_private_key(key_str: str, passphrase: Optional[str] = None):
    # Try every key type paramiko supports so Ed25519/ECDSA keys work, not just RSA.
    key_buffer = key_str.strip() + "\n"
    errors = []
    for key_class in (paramiko.Ed25519Key, paramiko.ECDSAKey, paramiko.RSAKey, paramiko.DSSKey):
        try:
            return key_class.from_private_key(StringIO(key_buffer), password=passphrase or None)
        except paramiko.PasswordRequiredException as exc:
            raise HTTPException(
                status_code=400,
                detail="Private key is encrypted: provide its passphrase.",
            ) from exc
        except Exception as exc:  # wrong key type or parse error — try the next class
            errors.append(f"{key_class.__name__}: {exc}")
    raise HTTPException(
        status_code=400,
        detail="Unsupported or invalid private key. Tried: " + "; ".join(errors),
    )


def _open_vps_ssh_client(payload: VpsConnectionPayload) -> paramiko.SSHClient:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    connect_kwargs = {
        "hostname": payload.host,
        "port": payload.port,
        "username": payload.username,
        "timeout": 15,
        "allow_agent": False,
        "look_for_keys": False,
    }

    if payload.private_key:
        connect_kwargs["pkey"] = _load_private_key(payload.private_key, payload.private_key_passphrase)
    else:
        connect_kwargs["password"] = payload.password

    ssh.connect(**connect_kwargs)
    return ssh


def _sftp_rmtree(sftp, path: str) -> None:
    # SFTP rmdir only removes empty dirs; recurse so deleting a folder actually works.
    for entry in sftp.listdir_attr(path):
        child = f"{path.rstrip('/')}/{entry.filename}"
        if stat.S_ISDIR(entry.st_mode):
            _sftp_rmtree(sftp, child)
        else:
            sftp.remove(child)
    sftp.rmdir(path)


def _sftp_error(exc: Exception) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    return HTTPException(status_code=400, detail=str(exc))


def _log_scan_paths():
    for scan_path in app_config.scan_paths:
        exists = Path(scan_path).exists()
        logger.info("scan_path=%s exists=%s", scan_path, exists)


async def run_application_scan():
    applications = await asyncio.to_thread(app_discovery_service.discover, app_config.scan_paths)
    containers = await asyncio.to_thread(docker_service.list_containers_for_association)
    associations = association_service.associate(applications, containers)
    domains_by_app = await asyncio.to_thread(domain_discovery_service.discover, applications, associations)
    aggregated = aggregation_service.aggregate(applications, associations, domains_by_app)
    await application_registry.set_applications(aggregated)

    assigned_count = sum(len(associations.get(app.id, [])) for app in applications)
    unassigned_count = len(associations.get("unassigned", []))
    matched_domains = sum(len(domains_by_app.get(app.id, [])) for app in applications)
    logger.info(
        "scan_complete applications=%s assigned_containers=%s unassigned_containers=%s domains=%s",
        len(applications),
        assigned_count,
        unassigned_count,
        matched_domains,
    )


async def scan_loop():
    while True:
        try:
            await run_application_scan()
        except Exception:
            logger.exception("scan_failed")
        await asyncio.sleep(app_config.scan_interval_seconds)


@app.on_event("startup")
async def on_startup():
    global scan_task
    _log_scan_paths()
    scan_task = asyncio.create_task(scan_loop())


@app.on_event("shutdown")
async def on_shutdown():
    if scan_task:
        scan_task.cancel()


@app.get("/api/containers")
def get_containers():
    return docker_service.list_containers()


def _get_container_or_404(container_id: str):
    try:
        return client.containers.get(container_id)
    except NotFound as exc:
        raise HTTPException(status_code=404, detail="Container not found") from exc


def _api_error_message(exc: Exception) -> str:
    return str(getattr(exc, "explanation", exc))


@app.post("/api/containers/{container_id}/restart")
async def restart_container(container_id: str):
    container = _get_container_or_404(container_id)
    try:
        container.restart()
    except APIError as exc:
        raise HTTPException(status_code=400, detail=_api_error_message(exc)) from exc
    await run_application_scan()
    return {"result": "restarted"}


@app.post("/api/containers/{container_id}/stop")
async def stop_container(container_id: str):
    container = _get_container_or_404(container_id)
    try:
        container.stop()
    except APIError as exc:
        raise HTTPException(status_code=400, detail=_api_error_message(exc)) from exc
    await run_application_scan()
    return {"result": "stopped"}


@app.get("/api/containers/{container_id}/logs")
def container_logs(container_id: str):
    container = _get_container_or_404(container_id)
    try:
        logs = container.logs(tail=200).decode("utf-8", errors="ignore")
    except APIError as exc:
        raise HTTPException(status_code=400, detail=_api_error_message(exc)) from exc
    return {"logs": logs}


@app.delete("/api/containers/{container_id}/delete-image")
async def delete_container_image(container_id: str):
    try:
        container = client.containers.get(container_id)
    except NotFound as exc:
        raise HTTPException(status_code=404, detail="Container not found") from exc

    image_id = container.image.id

    try:
        if container.status == "running":
            container.stop()
    except APIError:
        pass

    try:
        container.remove(force=True)
    except APIError as exc:
        raise HTTPException(status_code=400, detail=str(getattr(exc, "explanation", exc))) from exc

    try:
        client.images.remove(image=image_id, force=True)
    except ImageNotFound as exc:
        raise HTTPException(status_code=404, detail="Image not found") from exc
    except APIError as exc:
        raise HTTPException(status_code=400, detail=str(getattr(exc, "explanation", exc))) from exc

    await run_application_scan()
    return {"result": "image_deleted"}


@app.get("/api/applications")
async def get_applications():
    return await application_registry.get_applications()


@app.get("/api/applications/{application_id}")
async def get_application(application_id: str):
    app_data = await application_registry.get_application(application_id)
    if not app_data:
        raise HTTPException(status_code=404, detail="Application not found")
    return app_data


@app.get("/api/applications/{application_id}/git-status")
async def get_application_git_status(application_id: str):
    app_data = await application_registry.get_application(application_id)
    if not app_data:
        raise HTTPException(status_code=404, detail="Application not found")
    path = app_data.get("path")
    if not path:
        raise HTTPException(status_code=400, detail="Application has no filesystem path")

    return await asyncio.to_thread(git_metadata_service.get_git_status, Path(path))


@app.get("/api/applications/{application_id}/branches")
async def get_application_branches(application_id: str):
    app_data = await application_registry.get_application(application_id)
    if not app_data:
        raise HTTPException(status_code=404, detail="Application not found")
    path = app_data.get("path")
    if not path:
        raise HTTPException(status_code=400, detail="Application has no filesystem path")

    return await asyncio.to_thread(git_metadata_service.list_remote_branches, Path(path))


@app.post("/api/applications/{application_id}/pull")
async def pull_application_branch(application_id: str, payload: dict):
    app_data = await application_registry.get_application(application_id)
    if not app_data:
        raise HTTPException(status_code=404, detail="Application not found")
    path = app_data.get("path")
    if not path:
        raise HTTPException(status_code=400, detail="Application has no filesystem path")

    branch = (payload or {}).get("branch")
    result = await asyncio.to_thread(git_metadata_service.pull_branch, Path(path), branch)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Git pull failed")
    return result


@app.post("/api/applications/{application_id}/compose")
async def run_application_compose(application_id: str, payload: dict):
    app_data = await application_registry.get_application(application_id)
    if not app_data:
        raise HTTPException(status_code=404, detail="Application not found")
    path = app_data.get("path")
    if not path:
        raise HTTPException(status_code=400, detail="Application has no filesystem path")

    action = (payload or {}).get("action")
    result = await asyncio.to_thread(git_metadata_service.compose_action, Path(path), action)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Compose action failed")
    await run_application_scan()
    return result


@app.post("/api/vps/list-files")
async def vps_list_files(payload: VpsListFilesPayload):
    try:
        ssh = await asyncio.to_thread(_open_vps_ssh_client, payload)
        sftp = ssh.open_sftp()
        entries = []
        normalized_path = payload.path or "."
        for item in sftp.listdir_attr(normalized_path):
            is_dir = stat.S_ISDIR(item.st_mode)
            entries.append(
                {
                    "name": item.filename,
                    "path": f"{normalized_path.rstrip('/')}/{item.filename}" if normalized_path != "/" else f"/{item.filename}",
                    "isDirectory": is_dir,
                    "size": item.st_size,
                    "modified": item.st_mtime,
                }
            )

        entries.sort(key=lambda entry: (not entry["isDirectory"], entry["name"].lower()))
        sftp.close()
        ssh.close()
        return {"path": normalized_path, "entries": entries}
    except Exception as exc:
        raise _sftp_error(exc) from exc


@app.post("/api/vps/read-file")
async def vps_read_file(payload: VpsReadFilePayload):
    try:
        ssh = await asyncio.to_thread(_open_vps_ssh_client, payload)
        sftp = ssh.open_sftp()
        with sftp.open(payload.path, "r") as remote_file:
            content = remote_file.read().decode("utf-8", errors="ignore")
        sftp.close()
        ssh.close()
        return {"path": payload.path, "content": content}
    except Exception as exc:
        raise _sftp_error(exc) from exc


@app.post("/api/vps/write-file")
async def vps_write_file(payload: VpsWriteFilePayload):
    try:
        ssh = await asyncio.to_thread(_open_vps_ssh_client, payload)
        sftp = ssh.open_sftp()
        with sftp.open(payload.path, "w") as remote_file:
            remote_file.write(payload.content.encode("utf-8"))
        sftp.close()
        ssh.close()
        return {"ok": True, "path": payload.path}
    except Exception as exc:
        raise _sftp_error(exc) from exc


@app.post("/api/vps/delete-path")
async def vps_delete_path(payload: VpsDeletePathPayload):
    try:
        ssh = await asyncio.to_thread(_open_vps_ssh_client, payload)
        sftp = ssh.open_sftp()
        mode = sftp.stat(payload.path).st_mode
        if stat.S_ISDIR(mode):
            await asyncio.to_thread(_sftp_rmtree, sftp, payload.path)
        else:
            sftp.remove(payload.path)
        sftp.close()
        ssh.close()
        return {"ok": True}
    except Exception as exc:
        raise _sftp_error(exc) from exc


@app.post("/api/vps/create-directory")
async def vps_create_directory(payload: VpsCreateDirectoryPayload):
    try:
        ssh = await asyncio.to_thread(_open_vps_ssh_client, payload)
        sftp = ssh.open_sftp()
        sftp.mkdir(payload.path)
        sftp.close()
        ssh.close()
        return {"ok": True, "path": payload.path}
    except Exception as exc:
        raise _sftp_error(exc) from exc


@app.post("/api/vps/run-command")
async def vps_run_command(payload: VpsRunCommandPayload):
    command = (payload.command or "").strip()
    if not command:
        raise HTTPException(status_code=400, detail="Command is required")

    cwd = (payload.cwd or "~").strip() or "~"
    marker = "__DUMBDOCKER_PWD__"
    wrapped_command = (
        f"cd {shlex.quote(cwd)} >/dev/null 2>&1; "
        f"{command}; "
        "status=$?; "
        f"printf '\\n{marker}%s\\n' \"$PWD\"; "
        "exit $status"
    )

    try:
        ssh = await asyncio.to_thread(_open_vps_ssh_client, payload)
        stdin, stdout, stderr = ssh.exec_command(wrapped_command, timeout=60)
        exit_status = stdout.channel.recv_exit_status()
        output = stdout.read().decode("utf-8", errors="ignore")
        errors = stderr.read().decode("utf-8", errors="ignore")

        current_path = cwd
        marker_index = output.rfind(marker)
        if marker_index != -1:
            current_path = output[marker_index + len(marker):].strip().splitlines()[0]
            output = output[:marker_index].rstrip()

        ssh.close()
        return {
            "ok": exit_status == 0,
            "exitStatus": exit_status,
            "stdout": output,
            "stderr": errors,
            "cwd": current_path,
        }
    except Exception as exc:
        raise _sftp_error(exc) from exc


@app.post("/api/vps/test-connection")
async def vps_test_connection(payload: VpsConnectionPayload):
    def _do_test():
        ssh = _open_vps_ssh_client(payload)
        try:
            _, stdout, _ = ssh.exec_command("whoami; uname -srm", timeout=15)
            stdout.channel.recv_exit_status()
            lines = stdout.read().decode("utf-8", errors="ignore").strip().splitlines()
            who = lines[0].strip() if lines else payload.username
            info = lines[1].strip() if len(lines) > 1 else ""
            return who, info
        finally:
            ssh.close()

    try:
        who, info = await asyncio.to_thread(_do_test)
        return {"ok": True, "user": who, "host": payload.host, "info": info}
    except Exception as exc:
        raise _sftp_error(exc) from exc


@app.post("/api/vps/upload-file")
async def vps_upload_file(payload: VpsUploadFilePayload):
    try:
        raw = base64.b64decode(payload.content_base64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid file data: {exc}") from exc

    filename = Path(payload.filename).name  # strip any path component for safety
    if not filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    directory = payload.path or "."
    if directory == "/":
        remote_path = f"/{filename}"
    elif directory in ("", "."):
        remote_path = filename
    else:
        remote_path = f"{directory.rstrip('/')}/{filename}"

    def _do_upload():
        ssh = _open_vps_ssh_client(payload)
        try:
            sftp = ssh.open_sftp()
            with sftp.open(remote_path, "w") as remote_file:
                remote_file.write(raw)
            sftp.close()
        finally:
            ssh.close()

    try:
        await asyncio.to_thread(_do_upload)
        return {"ok": True, "path": remote_path, "size": len(raw)}
    except Exception as exc:
        raise _sftp_error(exc) from exc


@app.post("/api/vps/download-file")
async def vps_download_file(payload: VpsDownloadFilePayload):
    def _do_download():
        ssh = _open_vps_ssh_client(payload)
        try:
            sftp = ssh.open_sftp()
            file_stat = sftp.stat(payload.path)
            if stat.S_ISDIR(file_stat.st_mode):
                raise HTTPException(status_code=400, detail="Path is a directory, not a file")
            with sftp.open(payload.path, "rb") as remote_file:
                data = remote_file.read()
            sftp.close()
            return data
        finally:
            ssh.close()

    try:
        data = await asyncio.to_thread(_do_download)
        return {
            "path": payload.path,
            "filename": Path(payload.path).name,
            "size": len(data),
            "content_base64": base64.b64encode(data).decode("ascii"),
        }
    except Exception as exc:
        raise _sftp_error(exc) from exc


@app.post("/api/vps/rename-path")
async def vps_rename_path(payload: VpsRenamePayload):
    if not payload.new_path:
        raise HTTPException(status_code=400, detail="New path is required")

    def _do_rename():
        ssh = _open_vps_ssh_client(payload)
        try:
            sftp = ssh.open_sftp()
            try:
                sftp.posix_rename(payload.path, payload.new_path)
            except (IOError, OSError):
                sftp.rename(payload.path, payload.new_path)
            sftp.close()
        finally:
            ssh.close()

    try:
        await asyncio.to_thread(_do_rename)
        return {"ok": True, "path": payload.new_path}
    except Exception as exc:
        raise _sftp_error(exc) from exc


def _read_meminfo() -> dict:
    info = {}
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, _, rest = line.partition(":")
            parts = rest.strip().split()
            if parts:
                info[key] = int(parts[0]) * 1024  # kB -> bytes
    except (OSError, ValueError):
        return {}
    total = info.get("MemTotal", 0)
    available = info.get("MemAvailable", info.get("MemFree", 0))
    return {
        "total": total,
        "available": available,
        "used": max(0, total - available),
        "usedPercent": round((total - available) / total * 100, 1) if total else 0.0,
    }


def _read_disk(path: str = "/opt") -> dict:
    for candidate in (path, "/"):
        try:
            usage = shutil.disk_usage(candidate)
        except OSError:
            continue
        return {
            "path": candidate,
            "total": usage.total,
            "used": usage.used,
            "free": usage.free,
            "usedPercent": round(usage.used / usage.total * 100, 1) if usage.total else 0.0,
        }
    return {}


def _read_uptime() -> Optional[float]:
    try:
        return float(Path("/proc/uptime").read_text().split()[0])
    except (OSError, ValueError, IndexError):
        return None


def _collect_docker_df() -> dict:
    try:
        df = client.df()
    except Exception:
        return {}
    images = df.get("Images") or []
    containers = df.get("Containers") or []
    volumes = df.get("Volumes") or []
    build_cache = df.get("BuildCache") or []
    layers_size = df.get("LayersSize") or sum(int(i.get("Size") or 0) for i in images)
    return {
        "images": len(images),
        "imagesSize": int(layers_size or 0),
        "containers": len(containers),
        "containersRunning": sum(1 for c in containers if str(c.get("State")) == "running"),
        "volumes": len(volumes),
        "volumesSize": sum(int((v.get("UsageData") or {}).get("Size") or 0) for v in volumes),
        "buildCacheSize": sum(int(b.get("Size") or 0) for b in build_cache),
    }


@app.get("/api/system/overview")
async def system_overview():
    def _collect():
        load1 = load5 = load15 = None
        try:
            load1, load5, load15 = os.getloadavg()
        except (OSError, AttributeError):
            pass
        return {
            "cpuCount": os.cpu_count() or 1,
            "loadAverage": {"1m": load1, "5m": load5, "15m": load15},
            "memory": _read_meminfo(),
            "disk": _read_disk("/opt"),
            "uptimeSeconds": _read_uptime(),
            "docker": _collect_docker_df(),
            "scanPaths": app_config.scan_paths,
            "scanIntervalSeconds": app_config.scan_interval_seconds,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    return await asyncio.to_thread(_collect)
