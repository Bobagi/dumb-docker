# Dumb Docker

This repository contains a small Docker Compose setup that runs a Next.js
dashboard and a FastAPI API. The frontend visualises the Docker containers on
your machine using [React Flow](https://reactflow.dev) and lets you start, stop
or restart them and view their logs. API calls are proxied through Next.js to
the backend so both services can talk to the local Docker daemon.

## Features

- Next.js frontend secured with [NextAuth](https://next-auth.js.org) Credentials provider
- Graph view of your containers powered by React Flow
- Start, stop and restart containers from the UI
- View container logs directly in the browser
- FastAPI backend that communicates with the Docker socket

## Environment Variables

The following variables can be defined in a `.env` file at the repository root:

- `FRONTEND_PORT` – host port used for the Next.js app (default `3000`).
- `BACKEND_PORT` – host port used for the FastAPI backend (default `8000`).
- `BACKEND_URL` – address of the backend when the frontend runs outside
  Docker Compose.

The frontend also requires a separate `.env` file under `frontend/` for the
authentication settings. See `frontend/.env.example` for the full list, but the
important ones are:

- `NEXTAUTH_SECRET` – random string used to sign NextAuth sessions.
- `ADMIN_USERNAME` and either `ADMIN_PASSWORD_SHA256` or `ADMIN_PASSWORD` –
  credentials for the admin login.

Example root `.env` file:

```bash
FRONTEND_PORT=3000
BACKEND_PORT=8000
```
The Compose CLI automatically loads variables from this file.

If you are running in GitHub Codespaces, make sure these ports are forwarded in your devcontainer or compose configuration so the API proxy works correctly.

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
`--build` flag so the backend dependencies are installed:

```bash
docker-compose up --build
```

This starts the frontend on the port defined in `FRONTEND_PORT` (default `3000`)
and the FastAPI backend on the port defined in `BACKEND_PORT` (default `8000`).
The backend source is mounted with `uvicorn --reload`, so code changes take
effect immediately once the containers are up.

If you run the Next.js app without Docker Compose, set `BACKEND_URL` so the API
routes know where to proxy requests, for example:

```bash
BACKEND_URL=http://localhost:8000 npm run dev
```
