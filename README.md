# Dumb Docker

This repo contains a simple Next.js frontend with a FastAPI backend container. The frontend automatically
proxies API requests to the backend so it can access the Docker data.

## Environment Variables

- `FRONTEND_PORT` – host port to expose the frontend. Defaults to `3000`.
- `BACKEND_PORT` – host port to expose the backend API. Defaults to `8000`.

Create a `.env` file in the project root to override these ports:

```bash
FRONTEND_PORT=3000
BACKEND_PORT=8000
```
The Compose CLI automatically loads variables from this file.

If you are running in GitHub Codespaces, ensure these variables are defined in your devcontainer or compose configuration so the ports are forwarded correctly.

## Setup

Before starting the containers, install the frontend dependencies. The compose file mounts the source and runs `npm run dev`, so the packages must be installed. Docker Compose will install them automatically, but doing it manually first speeds up the initial boot.

```bash
cd frontend && npm install
```

This is required because `docker-compose.yml` mounts the frontend source and
executes `npm run dev`. The dev server fails to start if `node_modules` is
missing.

## Development

Run the application with Docker Compose. The first time you run it, include the
`--build` flag so the backend image is created:

```bash
docker-compose up --build
```

This starts the frontend on the port defined in `FRONTEND_PORT` (default `3000`)
and the FastAPI backend on the port defined in `BACKEND_PORT` (default `8000`).
