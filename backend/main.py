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
            "image": c.image.tags
        })
    return result
