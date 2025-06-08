# Frontend

This is a minimal Next.js frontend that displays Docker containers using React Flow.

## Authentication

The frontend uses [NextAuth.js](https://next-auth.js.org) with a Credentials provider.
Configure the required environment variables in `.env` (see `.env.example`).
Set `ADMIN_USERNAME` and either a bcrypt hashed `ADMIN_PASSWORD_HASH` or a plain
`ADMIN_PASSWORD` for the admin login.
`NEXTAUTH_SECRET` is a random string used by NextAuth to sign session tokens.
Unauthenticated users will be redirected to `/login`.

Run development server:

```bash
npm run dev
```

First install dependencies with:

```bash
npm install
```
