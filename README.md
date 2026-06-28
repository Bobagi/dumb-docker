# Dumb Docker

<p align="center">
  <img src="frontend/public/favicon_background.svg" alt="Dumb Docker logo" width="120" />
</p>

**Dumb Docker** is a lightweight dashboard for self-hosters.
It helps you see, organize, and control Docker containers running on your VPS.

## Why use it?

- 🐳 View all containers in one place
- 📦 Group containers by application/repository
- 🔗 Show GitHub repo link, branch, and commit for each app
- 🔄 Restart/stop containers quickly, pull branches and deploy with `compose up`
- 📜 Read logs in the browser
- 📊 See per-application resource share
- 🖥️ **System tab**: host CPU load, memory, disk, uptime and Docker disk usage
  (images / volumes / build-cache sizes) — see what's actually eating space
- 🔐 **VPS tab (SFTP + SSH)**: browse the filesystem, edit text files, **upload**
  and **download** files, rename, create/delete folders, and run commands (with a
  mini-terminal that remembers command history)

Great for personal servers, homelabs, and small production VPS deployments.

## Visual preview

Dumb Docker was designed to be friendly and practical: open the panel, see your apps, click to manage containers, done.

<img width="1918" height="991" alt="image" src="https://github.com/user-attachments/assets/e4ab72ef-48d5-465c-b437-5cda053c7c3c" />

## Quick Start (Docker Compose)

### 1) Clone

```bash
git clone https://github.com/Bobagi/dumb-docker.git
cd dumb-docker
```

### 2) Create root `.env` (same directory as `docker-compose.yml`)

Copy the template and fill it in (the real `.env` is gitignored so secrets stay out of git):

```bash
cp .env.example .env
```

At minimum set `FRONTEND_PORT`, `BACKEND_PORT`, a strong `NEXTAUTH_SECRET`, and
**an admin credential** (`ADMIN_USERNAME` + `ADMIN_PASSWORD_SHA256`) — without a
configured password the login screen rejects every attempt, so the dashboard
stays unreachable. Generate the pieces with:

```bash
openssl rand -base64 32                          # NEXTAUTH_SECRET
printf '%s' 'your-admin-password' | sha256sum    # ADMIN_PASSWORD_SHA256
```

You can also keep your auth + VPS defaults in this same root `.env` (recommended when running with Docker Compose).

**Correct path:** `dumb-docker/.env` (project root, next to `docker-compose.yml`).

The frontend service now loads root vars through `env_file: ./.env`, explicit environment mappings, and also mounts this file to `/app/.env.local` so Next.js reads it directly at startup.

### 3) Configure login for dashboard

Create `frontend/.env` (or copy from `frontend/.env.example`):

```bash
cp frontend/.env.example frontend/.env
```

Set at least:

- `NEXTAUTH_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD` **or** `ADMIN_PASSWORD_SHA256`

### 4) Start

```bash
docker compose up --build
```

> Important: run this command from the project root (`dumb-docker/`).

Open: `http://YOUR_SERVER_IP:3000`

### 5) (Optional) Pre-fill VPS tab connection fields

If you want the VPS connection form to be auto-filled in the **VPS SFTP** tab, add these keys to your root `.env` (or to `frontend/.env`):

```bash
NEXT_PUBLIC_VPS_HOST=your.vps.host
NEXT_PUBLIC_VPS_PORT=22
NEXT_PUBLIC_VPS_USERNAME=root
NEXT_PUBLIC_VPS_PASSWORD=your_password
NEXT_PUBLIC_VPS_PRIVATE_KEY=
NEXT_PUBLIC_VPS_PATH=/etc/nginx/sites-available
NEXT_PUBLIC_VPS_DEFAULT_COMMAND=nginx -t
```

Server-side alternative (recommended for secrets):

```bash
VPS_HOST=your.vps.host
VPS_PORT=22
VPS_USERNAME=root
VPS_PASSWORD=your_password
VPS_PRIVATE_KEY=
VPS_PATH=/etc/nginx/sites-available
VPS_DEFAULT_COMMAND=nginx -t
```

> This is optional, but if you add password/private key there, the form will be pre-filled automatically so you do not need to type them every time. If password does not auto-fill with `NEXT_PUBLIC_VPS_PASSWORD`, use `VPS_PASSWORD`.

> If your password contains `#`, wrap it in quotes, e.g. `NEXT_PUBLIC_VPS_PASSWORD="fu5#0Fjx6jwFzC"`.

## Daily commands

### Restart stack

If you changed code/dependencies, use rebuild:

```bash
docker compose down
docker compose up --build -d
```

If you changed only runtime env values and images are already built, this is usually enough:

```bash
docker compose down
docker compose up -d --force-recreate
```

### See logs

```bash
docker compose logs -f
```

### Update after pulling new code

```bash
git pull
docker compose down
docker compose up --build -d
```

## Application-aware scan

The backend scans these paths by default:

- `/opt`
- `/srv`
- `/var/www`

An app is detected when a folder has at least one of:

- `.git`
- `docker-compose.yml` / `docker-compose.yaml` / `compose.yml` / `compose.yaml`
- `Dockerfile`

`docker-compose.yml` already mounts these host paths read-only into the backend container so discovery works on VPS.

### Domain/subdomain detection (Nginx)

The backend also scans `/etc/nginx` (mounted read-only) and tries to map `server_name` entries to each detected application by:

- matching `proxy_pass` host ports against the app's published Docker ports.

Matching is done **per `server { ... }` block** (not across the whole file), to avoid leaking domains from unrelated virtual hosts in the same config file.

When a match is found, the app card shows one or more 🌐 buttons that open the detected domain in a new tab. Hovering the button shows the config source file and match strategy.

Domains are grouped in the UI as:
- **Sites via Docker** (matched by `proxy_pass` host port).

### Scanner config

`backend/config.yml`:

```yaml
applications:
  scanPaths:
    - /opt
    - /srv
    - /var/www
  scanIntervalSeconds: 60
```

You can override with env vars:

- `APPLICATION_SCAN_PATHS` (comma-separated)
- `APPLICATION_SCAN_INTERVAL_SECONDS`

## API endpoints

Existing container endpoints remain available.

Applications:

- `GET /api/applications`
- `GET /api/applications/:id`
- `GET /api/applications/:id/git-status`
- `GET /api/applications/:id/branches`
- `POST /api/applications/:id/pull`
- `POST /api/applications/:id/compose`

Host system:

- `GET /api/system/overview` — CPU load, memory, disk, uptime, and Docker disk usage

VPS (SFTP + SSH) — all `POST`, take the connection fields in the body:

- `/api/vps/test-connection`
- `/api/vps/list-files`, `/api/vps/read-file`, `/api/vps/write-file`
- `/api/vps/upload-file` (base64), `/api/vps/download-file` (base64)
- `/api/vps/rename-path`, `/api/vps/create-directory`, `/api/vps/delete-path` (recursive)
- `/api/vps/run-command`

All `/api/*` routes require an authenticated dashboard session. The backend
itself is **not** published to the host — the frontend reaches it over the
internal Docker network only. SSH auth supports passwords and Ed25519 / ECDSA /
RSA / DSS private keys (with an optional passphrase).

## Notes

- This project is optimized for practical VPS usage.
- If you run from Docker Compose, rebuild on backend changes to ensure dependencies/tools (like `git`) are present inside the backend container.
