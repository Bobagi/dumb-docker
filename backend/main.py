import asyncio
import logging
import stat
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


def _open_vps_ssh_client(payload: VpsConnectionPayload) -> paramiko.SSHClient:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    connect_kwargs = {
        "hostname": payload.host,
        "port": payload.port,
        "username": payload.username,
        "timeout": 15,
    }

    if payload.private_key:
        private_key = paramiko.RSAKey.from_private_key(StringIO(payload.private_key))
        connect_kwargs["pkey"] = private_key
    else:
        connect_kwargs["password"] = payload.password

    ssh.connect(**connect_kwargs)
    return ssh


def _sftp_error(exc: Exception) -> HTTPException:
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
            remote_file.write(payload.content)
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
            sftp.rmdir(payload.path)
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

    try:
        ssh = await asyncio.to_thread(_open_vps_ssh_client, payload)
        stdin, stdout, stderr = ssh.exec_command(command, timeout=60)
        exit_status = stdout.channel.recv_exit_status()
        output = stdout.read().decode("utf-8", errors="ignore")
        errors = stderr.read().decode("utf-8", errors="ignore")
        ssh.close()
        return {
            "ok": exit_status == 0,
            "exitStatus": exit_status,
            "stdout": output,
            "stderr": errors,
        }
    except Exception as exc:
        raise _sftp_error(exc) from exc
