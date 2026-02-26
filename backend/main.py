import asyncio
import logging
from pathlib import Path

import docker
from docker.errors import APIError, ImageNotFound, NotFound
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

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
