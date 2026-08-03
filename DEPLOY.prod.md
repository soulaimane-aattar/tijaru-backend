# Production deploy

Backend + Postgres + OCR run in Docker behind the **existing manual nginx proxy**
at `../euras/eurasians-proxy` (container `nginx-proxy`, network `nginx-proxy`).
Web is a static build on **Cloudflare Pages** (not in this stack).

```
Cloudflare Pages (web SPA) ──HTTPS──> nginx-proxy ──> tijaru-backend:3000
                                          │                  ├── postgres (internal only)
                                     (only 443 exposed)      └── ocr:8000 (internal only)
```

Only `nginx-proxy` publishes host ports. `tijaru-backend`, `tijaru-postgres` and
`tijaru-ocr` publish **nothing** — backend is reachable solely via the
`nginx-proxy` network, and receipts never leave the internal network.

## 1. Backend + DB + OCR

Prereqs: the nginx-proxy stack is up and owns the external `nginx-proxy` network,
and `ocr-service/` sits next to `backend/` (it is the `ocr` build context).

The prod stack lives in `backend/` (same folder as the dev `docker-compose.yml`).

```bash
cd backend
cp .env.prod.example .env.prod
# edit: strong POSTGRES_PASSWORD, matching DATABASE_URL, CORS_ORIGINS (Pages origin),
#       admin creds, JWT secrets:  openssl rand -hex 32   (one per secret)

make deploy        # = docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

`make` (no target) lists everything. Prod targets:

| Target | Does |
|---|---|
| `make deploy` | build + start the whole prod stack |
| `make prod-logs` | tail backend logs |
| `make prod-ps` | stack status |
| `make prod-restart` | restart backend only |
| `make prod-migrate` | apply migrations manually |
| `make prod-psql` | psql shell on the prod DB |
| `make prod-backup` | `pg_dump` to `backup-<utc>.sql` |
| `make prod-down` | stop stack, volumes (data) kept |

Every prod target aborts with a hint if `.env.prod` is missing.

- `DATABASE_URL` is read straight from `backend/.env.prod` (backend `env_file`), host `postgres:5432`.
- `.env.prod` is gitignored — never commit it.
- OCR: `tijaru-ocr` on the internal net only; backend reaches it at `http://ocr:8000`.
  `OCR_LANGS=fr` by default; `fr,ar` adds an Arabic pass and roughly doubles latency.
- Receipt images persist in the `tijaru-uploads` volume mounted at `/srv/uploads`.
- Backend joins the `nginx-proxy` network with alias `tijaru-backend`.
- Container runs `prisma migrate deploy` on start, then serves. No seed in prod.
- Image: multi-stage `backend/Dockerfile.prod` (build context = `backend/`) — debian-slim,
  dev deps pruned, non-root.

## 2. nginx route (api.tijaru.ma)

The site conf already lives at:
`../euras/eurasians-proxy/nginx/sites-available/api.tijaru.ma.conf`
(proxies `api.tijaru.ma` → `http://tijaru-backend:3000`).

```bash
# Install the TLS cert (Let's Encrypt) where the conf expects it:
#   /etc/nginx/ssl/api.tijaru.ma/fullchain.pem
#   /etc/nginx/ssl/api.tijaru.ma/privkey.pem
# i.e. euras/eurasians-proxy/ssl/api.tijaru.ma/{fullchain,privkey}.pem

cd ../euras/eurasians-proxy
docker exec nginx-proxy nginx -t     # validate (needs tijaru-backend up + cert present)
docker exec nginx-proxy nginx -s reload
```

Point DNS `api.tijaru.ma` → the server, and issue the cert before reload
(nginx won't start a TLS server block without the cert files).

## 3. Web (Cloudflare Pages)

| Setting              | Value                                    |
|----------------------|------------------------------------------|
| Root directory       | `web`                                    |
| Build command        | `npm run build`                          |
| Build output dir     | `dist`                                   |
| Env var (Production) | `VITE_API_URL=https://api.tijaru.ma/api/v1` |

- SPA deep links handled by `web/public/_redirects` (`/* /index.html 200`).
- The Pages origin **must** be in the backend `CORS_ORIGINS`.
