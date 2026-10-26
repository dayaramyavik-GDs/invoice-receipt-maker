# Invoice & Receipt Maker

Offline-first Android app for sole traders, cleaners, tutors, tradespeople and market sellers to create
branded invoices and receipts, track what is paid and unpaid, and share PDFs — with optional cloud sync.

## Features

**Works fully offline (MVP)**
- Business profile with logo, VAT number, payment instructions, default tax and payment terms
- Customers and a saved items/services catalogue
- Invoices and receipts with itemised lines, quantities, prices and tax — totals calculated in integer pence
- Automatic numbering (`INV-0001`, `REC-0001`) assigned when a document is issued
- Statuses: draft, unpaid, part-paid, overdue, paid, void; mark as paid / record part payments
- Branded A4 PDF generated on the phone and shared through the Android share sheet
- Dashboard (outstanding, overdue, received this month), filters and search
- JSON backup export

**Optional online features**
- Account (email + password, bcrypt + JWT) and two-way sync to MongoDB
- Works across devices; conflicts resolved automatically (payments are never lost) with a review screen
- In-app account deletion

## Architecture

```
Android phone (Cordova APK)            Kubernetes (or Docker Compose locally)        Cloud
  UI: HTML/CSS/JS modules     HTTPS     Ingress (Traefik + cert-manager TLS)
  SQLite  ← offline data     ──────▶      → Service → 2–6 Express API pods  ──TLS──▶  MongoDB Atlas
  jsPDF   ← on-device PDFs     REST
  outbox  ← pending sync       + JWT
```

The APK is built separately with Gradle; only the backend runs in containers. See
[docs/architecture.md](docs/architecture.md) for the data model and sync design.

## Tech stack

| Layer | Technology |
|---|---|
| Mobile | Apache Cordova (cordova-android 15), vanilla JS ES modules, cordova-sqlite-storage, jsPDF |
| API | Node.js 24, Express 5, Mongoose 9, Zod 4, bcrypt, jsonwebtoken, helmet, express-rate-limit |
| Data | SQLite on the device, MongoDB 8 (local container / Atlas) |
| Ops | Docker (multi-stage), Docker Compose, Kubernetes + Kustomize, GitHub Actions, GHCR |

## Repository structure

```
mobile-client/   Cordova app (www/ is the app; dev/ is a browser-only dev server, never packaged)
backend/         Express API, Dockerfile, tests
k8s/             Kubernetes manifests (kustomization.yaml lists what gets applied)
docs/            Architecture, test plan, screenshots, release notes
.github/         CI, image publishing, Dependabot, PR template
docker-compose.yml          Local API + MongoDB
docker-compose.prod.yml     Production image against Atlas
```

## Getting started (Windows)

Prerequisites: Node.js 24 LTS, Git, JDK 17, Android Studio (SDK + platform-tools), Gradle, Cordova CLI
(`npm i -g cordova`), Docker Desktop.

### 1. Backend with Docker Compose

```powershell
Copy-Item .env.example .env                  # set MONGO_ROOT_USER / MONGO_ROOT_PASSWORD
Copy-Item backend\.env.example backend\.env  # set the two JWT secrets
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # generate a secret
docker compose up --build -d
docker compose ps                            # both services "healthy"
curl.exe http://localhost:3000/health/ready  # {"status":"ready"}
```

If ports 3000 or 27017 are already used on your PC, set `API_HOST_PORT` / `MONGO_HOST_PORT` in `.env`.
Live reload while editing `backend/src`: `docker compose watch`.

### 2. Mobile app in the browser (quick UI work)

```powershell
cd mobile-client
npm install            # also copies jsPDF into www/lib
npm run dev            # http://localhost:8000 (set API_ORIGIN if the API isn't on :3000)
```

The dev server swaps in a WebAssembly SQLite (sql.js) for the native plugin. Reset its data from the
browser console with `__resetDevDb()`.

### 3. Mobile app on an Android phone

```powershell
cd mobile-client
cordova requirements
npm run android        # cordova run android --device (USB debugging on)
```

Debug in desktop Chrome at `chrome://inspect/#devices`. To sync from the phone to your local API, expose it
over HTTPS with `cloudflared tunnel --url http://localhost:3000` and put the URL in `www/js/config.js`
(`API_ORIGIN`). The CSP in `index.html` and `<access>` in `config.xml` already allow `*.trycloudflare.com`.

## Environment variables

| File | Variables |
|---|---|
| `.env` (compose) | `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD`, `MONGO_HOST_PORT`, `API_HOST_PORT` |
| `backend/.env` | `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `BCRYPT_ROUNDS`, `CORS_ORIGINS` |

Only the `.env.example` files are committed.

## Testing

```powershell
cd backend; npm run lint; npm test        # 11 API tests (in-memory MongoDB)
cd mobile-client; npm test                # money/tax/date/status unit tests
```

Manual offline/sync test plan and results: [docs/test-plan.md](docs/test-plan.md). Requests for the VS Code
REST Client: [backend/requests.http](backend/requests.http).

## Deployment

1. Image: pushed to GHCR by `.github/workflows/docker-publish.yml` on `main` and `v*` tags.
2. Cluster add-ons: Traefik and cert-manager (Helm); apply `k8s/cluster-issuer.yaml`.
3. Secret: `kubectl -n invoice-maker create secret generic invoice-api-secrets --from-env-file=k8s/secrets/prod.env`
   (`k8s/secrets/` is gitignored).
4. Deploy: set your hostname in `k8s/backend-ingress.yaml`, then `kubectl apply -k k8s/`.
5. Roll out a new version by changing `newTag` in `k8s/kustomization.yaml`; roll back with
   `kubectl -n invoice-maker rollout undo deployment/invoice-api`.
6. Point the app at the production URL (`www/js/config.js`, CSP `connect-src`, `config.xml` `<access>`), remove the
   tunnel entries, and build a signed release:
   `cordova build android --release --buildConfig=C:\keys\build.json -- --packageType=bundle`.

Local cluster (Docker Desktop Kubernetes): also apply `k8s/local/mongo-dev.yaml` and use
`kubectl -n invoice-maker port-forward svc/invoice-api 8080:80`.

## Security notes

- Passwords hashed with bcrypt (cost 12); 15-minute access tokens, 30-day revocable refresh tokens.
- Every sync query is scoped to the signed-in user; payloads validated with Zod; auth endpoints rate limited.
- API container runs as non-root with a read-only filesystem in Kubernetes.
- No secrets in the APK — it only contains the public API URL.

## Roadmap

Quotes/estimates, recurring invoices, overdue reminders, expense tracking, CSV export, app PIN, payment links.
