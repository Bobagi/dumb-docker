# Dumb Docker

This repo contains a simple Next.js frontend with a Node.js backend container. The frontend proxies API
requests to the backend using an internal environment variable.

## Environment Variables

- `BACKEND_URL` – address of the backend API. Defaults to `http://backend:8000` when not set.
  `docker-compose.yml` sets this to the backend service so the frontend can access the API in
  development.

If you are running in GitHub Codespaces, ensure this variable is set in your devcontainer or compose
configuration so the API proxy works correctly.

## Setup

Before starting the containers, install the frontend dependencies. The compose file mounts the source and runs `npm run dev`, so the packages must be installed locally first.

```bash
cd frontend && npm install
```

## Development

Run the application with Docker Compose. The first time you run it, include the
`--build` flag so the backend image is created:

```bash
docker-compose up --build
```

This starts the frontend on port `3000` and the Node.js backend on port `8000`.
