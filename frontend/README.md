# Frontend

This is a minimal Next.js frontend that displays Docker containers using React Flow.

## Authentication

The frontend uses [NextAuth.js](https://next-auth.js.org) with a Credentials provider.
Configure the required environment variables in `.env` (see `.env.example`).
Set `ADMIN_EMAIL` and a bcrypt hashed `ADMIN_PASSWORD_HASH` for the admin login.
Unauthenticated users will be redirected to `/login`.

Run development server:

```bash
npm run dev
```

First install dependencies with:

```bash
npm install
```
