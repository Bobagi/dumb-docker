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
        ports = []
        network_ports = c.attrs.get("NetworkSettings", {}).get("Ports") or {}
        for container_port, bindings in network_ports.items():
            if not bindings:
                continue
            for binding in bindings:
                host_port = binding.get("HostPort")
                host_ip = binding.get("HostIp")
                if host_port:
                    ports.append(
                        {
                            "host_port": host_port,
                            "container_port": container_port,
                            "host_ip": host_ip,
                        }
                    )
        result.append({
            "id": c.id,
            "name": c.name,
            "status": c.status,
            "image": c.image.tags[0] if c.image.tags else "",
            "project": c.labels.get("com.docker.compose.project"),
            "ports": ports,
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


@app.get("/api/containers/{container_id}/logs")
def container_logs(container_id: str):
    container = client.containers.get(container_id)
    logs = container.logs(tail=200).decode("utf-8", errors="ignore")
    return {"logs": logs}
