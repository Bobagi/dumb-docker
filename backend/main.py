from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import docker

app = FastAPI()
client = docker.DockerClient(base_url='unix://var/run/docker.sock')

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/containers")
def get_containers():
    containers = client.containers.list(all=True)
    result = []
    for c in containers:
        result.append({
            "id": c.id,
            "name": c.name,
            "status": c.status,
            "image": c.image.tags[0] if c.image.tags else ""
        })
    return result


@app.post("/api/containers/{container_id}/restart")
def restart_container(container_id: str):
    container = client.containers.get(container_id)
    container.restart()
    return {"result": "restarted"}


@app.post("/api/containers/{container_id}/stop")
def stop_container(container_id: str):
    container = client.containers.get(container_id)
    container.stop()
    return {"result": "stopped"}
