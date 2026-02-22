import asyncio
import hashlib
import json
import os
import subprocess
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import docker


@dataclass
class Application:
    id: str
    name: str
    path: str
    gitRemoteUrl: Optional[str]
    gitBranch: Optional[str]
    gitCommit: Optional[str]
    description: Optional[str]
    summary: Optional[str]
    containers: List[dict]
    lastScanTimestamp: str


class DockerService:
    def __init__(self, client: docker.DockerClient):
        self.client = client

    def _serialize_container(self, container, include_internal: bool = False):
        ports = []
        port_map = {}
        network_ports = container.attrs.get("NetworkSettings", {}).get("Ports") or {}
        for container_port, bindings in network_ports.items():
            if not bindings:
                continue
            for binding in bindings:
                host_port = binding.get("HostPort")
                if not host_port:
                    continue
                host_ip = binding.get("HostIp")
                key = (container_port, host_port)
                existing = port_map.get(key)
                prefers_current = existing and existing.get("host_ip") not in (None, "", "::")
                prefers_new = host_ip not in (None, "", "::")
                if existing and (prefers_current or not prefers_new):
                    continue
                port_map[key] = {
                    "host_port": host_port,
                    "container_port": container_port,
                    "host_ip": host_ip,
                }
        if port_map:
            ports = list(port_map.values())

        payload = {
            "id": container.id,
            "name": container.name,
            "status": container.status,
            "image": container.image.tags[0] if container.image.tags else "",
            "project": container.labels.get("com.docker.compose.project"),
            "ports": ports,
        }
        if include_internal:
            usage = self._read_container_usage(container)
            payload.update(usage)
            payload["labels"] = container.labels or {}
            payload["working_dir"] = container.attrs.get("Config", {}).get("WorkingDir")
            payload["mount_sources"] = [
                mount.get("Source")
                for mount in (container.attrs.get("Mounts") or [])
                if mount.get("Type") == "bind" and mount.get("Source")
            ]
        return payload

    def _read_container_usage(self, container) -> dict:
        try:
            stats = container.stats(stream=False)
        except Exception:
            return {"cpu_percent": 0.0, "memory_usage": 0, "memory_limit": 0}

        cpu_percent = 0.0
        try:
            cpu_total = (stats.get("cpu_stats", {}).get("cpu_usage", {}) or {}).get("total_usage", 0)
            prev_cpu_total = (stats.get("precpu_stats", {}).get("cpu_usage", {}) or {}).get("total_usage", 0)
            system_total = (stats.get("cpu_stats", {}) or {}).get("system_cpu_usage", 0)
            prev_system_total = (stats.get("precpu_stats", {}) or {}).get("system_cpu_usage", 0)
            cpu_delta = cpu_total - prev_cpu_total
            system_delta = system_total - prev_system_total
            online_cpus = (stats.get("cpu_stats", {}) or {}).get("online_cpus") or 1
            if cpu_delta > 0 and system_delta > 0:
                cpu_percent = (cpu_delta / system_delta) * online_cpus * 100.0
        except Exception:
            cpu_percent = 0.0

        memory = stats.get("memory_stats", {}) or {}
        memory_usage = int(memory.get("usage") or 0)
        memory_limit = int(memory.get("limit") or 0)
        return {"cpu_percent": round(cpu_percent, 3), "memory_usage": memory_usage, "memory_limit": memory_limit}

    def list_containers(self) -> List[dict]:
        containers = self.client.containers.list(all=True)
        return [self._serialize_container(c) for c in containers]

    def list_containers_for_association(self) -> List[dict]:
        containers = self.client.containers.list(all=True)
        return [self._serialize_container(c, include_internal=True) for c in containers]


class GitMetadataService:
    def _run_git(self, args: List[str], cwd: Path) -> Optional[str]:
        try:
            result = subprocess.run(
                ["git", *args],
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            if result.returncode != 0:
                return None
            return result.stdout.strip() or None
        except (subprocess.SubprocessError, FileNotFoundError):
            return None

    def read_repo_metadata(self, path: Path) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        remote = self._run_git(["remote", "get-url", "origin"], path)
        branch = self._run_git(["rev-parse", "--abbrev-ref", "HEAD"], path)
        commit = self._run_git(["rev-parse", "HEAD"], path)
        return remote, branch, commit

    def get_git_status(self, path: Path) -> dict:
        local_commit = self._run_git(["rev-parse", "HEAD"], path)
        branch = self._run_git(["rev-parse", "--abbrev-ref", "HEAD"], path)
        if not branch:
            return {
                "localCommit": local_commit,
                "remoteCommit": None,
                "ahead": 0,
                "behind": 0,
                "status": "unknown",
            }
        self._run_git(["fetch", "origin", branch], path)
        remote_commit = self._run_git(["rev-parse", f"origin/{branch}"], path)
        ahead_behind = self._run_git(["rev-list", "--left-right", "--count", f"origin/{branch}...HEAD"], path)
        ahead, behind = 0, 0
        if ahead_behind:
            parts = ahead_behind.split()
            if len(parts) == 2:
                behind = int(parts[0])
                ahead = int(parts[1])
        status = "up-to-date"
        if ahead and behind:
            status = "diverged"
        elif ahead:
            status = "ahead"
        elif behind:
            status = "behind"
        return {
            "localCommit": local_commit,
            "remoteCommit": remote_commit,
            "ahead": ahead,
            "behind": behind,
            "status": status,
        }


class ApplicationDiscoveryService:
    DISCOVERY_MARKERS = (
        ".git",
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
        "Dockerfile",
    )

    def __init__(self, git_service: GitMetadataService):
        self.git_service = git_service

    def _is_application_dir(self, path: Path) -> bool:
        return any((path / marker).exists() for marker in self.DISCOVERY_MARKERS)

    def _extract_readme_summary(self, path: Path) -> Optional[str]:
        readme_path = path / "README.md"
        if not readme_path.exists():
            return None
        try:
            content = readme_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return None
        paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
        if not paragraphs:
            return None
        first = paragraphs[0]
        lines = [line.strip("# ") for line in first.splitlines() if line.strip()]
        return " ".join(lines) if lines else None

    def _extract_package_metadata(self, path: Path) -> Tuple[Optional[str], Optional[str]]:
        package_json = path / "package.json"
        if not package_json.exists():
            return None, None
        try:
            data = json.loads(package_json.read_text(encoding="utf-8", errors="ignore"))
        except (OSError, json.JSONDecodeError):
            return None, None
        return data.get("name"), data.get("description")

    def discover(self, scan_paths: List[str]) -> List[Application]:
        discovered: List[Application] = []
        now = datetime.now(timezone.utc).isoformat()
        for root in scan_paths:
            root_path = Path(root)
            if not root_path.exists() or not root_path.is_dir():
                continue
            for current, dirs, _ in os.walk(root):
                current_path = Path(current)
                if not self._is_application_dir(current_path):
                    continue
                app_path = str(current_path.resolve())
                app_name = current_path.name
                package_name, description = self._extract_package_metadata(current_path)
                summary = self._extract_readme_summary(current_path)
                git_remote = git_branch = git_commit = None
                if (current_path / ".git").exists():
                    git_remote, git_branch, git_commit = self.git_service.read_repo_metadata(current_path)
                app_id = hashlib.sha1(app_path.encode("utf-8")).hexdigest()[:16]
                discovered.append(
                    Application(
                        id=app_id,
                        name=package_name or app_name,
                        path=app_path,
                        gitRemoteUrl=git_remote,
                        gitBranch=git_branch,
                        gitCommit=git_commit,
                        description=description,
                        summary=summary,
                        containers=[],
                        lastScanTimestamp=now,
                    )
                )
                dirs[:] = []
        return discovered


class ContainerAssociationService:
    def _find_app_by_prefix_path(self, candidate_path: str, apps_by_path: List[Tuple[str, str]]) -> Optional[str]:
        normalized = str(Path(candidate_path).resolve())
        for app_path, app_id in apps_by_path:
            if normalized == app_path or normalized.startswith(f"{app_path}/"):
                return app_id
        return None

    def associate(self, applications: List[Application], containers: List[dict]) -> Dict[str, List[dict]]:
        app_by_id = {app.id: app for app in applications}
        app_by_name = {app.name.lower(): app.id for app in applications}
        app_by_folder = {Path(app.path).name.lower(): app.id for app in applications}
        apps_by_path = sorted(((app.path, app.id) for app in applications), key=lambda item: len(item[0]), reverse=True)

        associations: Dict[str, List[dict]] = {app.id: [] for app in applications}
        associations["unassigned"] = []

        for container in containers:
            app_id = None
            labels = container.get("labels") or {}
            explicit_app = labels.get("com.dumbdocker.app")
            if explicit_app:
                normalized = explicit_app.lower()
                app_id = (
                    app_by_id.get(explicit_app)
                    or app_by_name.get(normalized)
                    or app_by_folder.get(normalized)
                )

            if not app_id:
                compose_project = labels.get("com.docker.compose.project") or container.get("project")
                if compose_project:
                    normalized = compose_project.lower()
                    app_id = app_by_name.get(normalized) or app_by_folder.get(normalized)

            if not app_id:
                for mount_source in container.get("mount_sources") or []:
                    app_id = self._find_app_by_prefix_path(mount_source, apps_by_path)
                    if app_id:
                        break

            if not app_id:
                working_dir = (container.get("working_dir") or "").rstrip("/")
                if working_dir:
                    app_id = self._find_app_by_prefix_path(working_dir, apps_by_path)

            if not app_id:
                cname = (container.get("name") or "").lower()
                for folder_name, candidate_id in app_by_folder.items():
                    if folder_name and folder_name in cname:
                        app_id = candidate_id
                        break

            target = app_id if app_id in associations else "unassigned"
            clean_container = {k: v for k, v in container.items() if k not in {"labels", "working_dir", "mount_sources"}}
            associations[target].append(clean_container)
        return associations


class ApplicationAggregationService:
    def _with_usage(self, app_data: dict) -> dict:
        containers = app_data.get("containers") or []
        app_cpu_percent = sum(float(c.get("cpu_percent") or 0.0) for c in containers)
        app_memory_usage = sum(int(c.get("memory_usage") or 0) for c in containers)
        app_data["resourceUsage"] = {
            "cpuPercent": round(app_cpu_percent, 3),
            "memoryBytes": app_memory_usage,
        }
        return app_data

    def aggregate(self, applications: List[Application], associations: Dict[str, List[dict]]) -> List[dict]:
        payload = []
        for app in applications:
            app.containers = associations.get(app.id, [])
            payload.append(self._with_usage(asdict(app)))

        unassigned = self._with_usage(
            {
                "id": "unassigned",
                "name": "Unassigned Containers",
                "path": None,
                "gitRemoteUrl": None,
                "gitBranch": None,
                "gitCommit": None,
                "description": None,
                "summary": None,
                "containers": associations.get("unassigned", []),
                "lastScanTimestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

        payload.append(unassigned)

        total_cpu = sum((item.get("resourceUsage") or {}).get("cpuPercent", 0.0) for item in payload)
        for item in payload:
            app_cpu = (item.get("resourceUsage") or {}).get("cpuPercent", 0.0)
            share = (app_cpu / total_cpu * 100.0) if total_cpu > 0 else 0.0
            item["resourceUsage"]["sharePercent"] = round(share, 2)

        payload.sort(key=lambda item: (item.get("resourceUsage", {}).get("sharePercent", 0.0), item.get("name", "").lower()), reverse=True)
        return payload


class ApplicationRegistry:
    def __init__(self):
        self._applications: List[dict] = []
        self._lock = asyncio.Lock()

    async def set_applications(self, applications: List[dict]):
        async with self._lock:
            self._applications = applications

    async def get_applications(self) -> List[dict]:
        async with self._lock:
            return list(self._applications)

    async def get_application(self, app_id: str) -> Optional[dict]:
        async with self._lock:
            return next((app for app in self._applications if app["id"] == app_id), None)
