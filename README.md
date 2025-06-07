# Docker Container Dashboard

This project provides a simple dashboard for Docker containers.

## Services

- **backend**: FastAPI API exposing `/api/containers`.
- **frontend**: Next.js app displaying containers using React Flow.

## Running with Docker Compose

```bash
docker-compose up --build
```

Then access http://localhost:3000 to view the dashboard.

The repository keeps the frontend lock file out of version control to avoid
large diffs. The Docker build runs `npm install` during the image build.
