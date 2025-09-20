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
        port_map = {}
        network_ports = c.attrs.get("NetworkSettings", {}).get("Ports") or {}
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
