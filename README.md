# Invoice & Receipt Maker

Offline-first Android app for sole traders, cleaners, tutors, tradespeople and market sellers to create
branded invoices and receipts, track what is paid and unpaid, and share PDFs — with optional cloud sync.

## Features

**Works fully offline (MVP)**
- Business profile with logo, VAT number, payment instructions, default tax and payment terms
- Customers and a saved items/services catalogue
- Invoices and receipts with itemised lines, quantities, prices and tax — totals calculated in integer pence
- Automatic numbering (`INV-0001`, `REC-0001`) assigned when a document is issued; an optional per-phone device
  code (`INV-A-0001`) keeps several phones from clashing offline
- Statuses: draft, unpaid, part-paid, overdue, paid, void; mark as paid / record part payments
- Branded A4 PDF generated on the phone and shared through the Android share sheet
- Dashboard (outstanding, overdue, received this month), filters and search
- JSON backup export

**Optional online features**
- Account (email + password, bcrypt + JWT) and two-way sync to MongoDB
- Works across devices: edits to different fields on two phones are merged automatically, payments are never
  lost, and only genuine same-field clashes go to a review screen
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
  api.config.json   Sync API URL baked into builds (empty = offline-only build)
backend/         Express API, Dockerfile, tests
k8s/base/        Kubernetes manifests: namespace, config, deployment, service, ingress, autoscaler
k8s/production/  Overlay adding your domain + Let's Encrypt HTTPS
k8s/local/       MongoDB with a persistent volume for local clusters
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

Debug in desktop Chrome at `chrome://inspect/#devices`. If `cordova requirements` picks the wrong Java, set
`JAVA_HOME` to a JDK 17 for that terminal.

**Sync API URL.** Builds read it from `mobile-client/api.config.json` (`"apiOrigin"`), or the `API_ORIGIN`
environment variable for a single build. A Cordova hook (`scripts/apply-api-origin.js`) bakes it into the app, the
CSP and the network allow-list. Leave it empty for an offline-only build (sign-in is hidden). Only `https://` URLs
are accepted, plus `http://localhost:<port>` for development.

To sync a phone or emulator with the API running on your PC:

```powershell
adb reverse tcp:3000 tcp:3000                 # the device's localhost:3000 → your PC
$env:API_ORIGIN = 'http://localhost:3000'; npm run android
```

For `http://localhost` builds the hook also adds an Android network-security rule allowing plain HTTP to localhost
only; HTTPS builds never contain it.

## Environment variables

| File | Variables |
|---|---|
| `.env` (compose) | `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD`, `MONGO_HOST_PORT`, `API_HOST_PORT` |
| `backend/.env` | `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `BCRYPT_ROUNDS`, `CORS_ORIGINS` |

Only the `.env.example` files are committed.

## Testing

```powershell
cd backend; npm run lint; npm test        # 11 API tests (in-memory MongoDB)
cd mobile-client; npm test                # 20 tests: money, tax, dates, statuses, sync merging, numbering
```

Manual offline/sync test plan and results: [docs/test-plan.md](docs/test-plan.md). Requests for the VS Code
REST Client: [backend/requests.http](backend/requests.http).

## Deployment

The image is pushed to GHCR (`ghcr.io/dayaramyavik-gds/invoice-receipt-maker-api`) by
`.github/workflows/docker-publish.yml` on `main` and `v*` tags.

### Local cluster (tested)

Any local Kubernetes works: Docker Desktop's built-in cluster, or k3s in Docker (which includes Traefik and
metrics-server):

```powershell
docker run -d --name invoice-k3s --privileged -p 127.0.0.1:6443:6443 -p 127.0.0.1:8081:80 `
  -e K3S_KUBECONFIG_OUTPUT=/output/kubeconfig.yaml -e K3S_KUBECONFIG_MODE=666 -v "${PWD}\.k3s:/output" rancher/k3s:latest server
$env:KUBECONFIG = "$PWD\.k3s\kubeconfig.yaml"
docker build -t ghcr.io/dayaramyavik-gds/invoice-receipt-maker-api:0.1.1 --target production ./backend
docker save ghcr.io/dayaramyavik-gds/invoice-receipt-maker-api:0.1.1 | docker exec -i invoice-k3s ctr -n k8s.io images import -
kubectl apply -f k8s/base/namespace.yaml
kubectl -n invoice-maker create secret generic mongo-dev-credentials --from-literal=username=devuser --from-literal=password=<choose>
kubectl -n invoice-maker create secret generic invoice-api-secrets --from-env-file=k8s/secrets/local.env
kubectl apply -f k8s/local/mongo-dev.yaml
kubectl apply -k k8s/base
curl.exe http://127.0.0.1:8081/health/ready      # through the Traefik ingress
```

`k8s/secrets/local.env` (gitignored) holds `MONGODB_URI=mongodb://devuser:<password>@mongo:27017/invoice_maker?authSource=admin`
and the two JWT secrets.

### Cloud cluster

1. Install Traefik and cert-manager (Helm).
2. Set your hostname in `k8s/production/ingress-tls.yaml` and your email in `k8s/production/cluster-issuer.yaml`
   (marked `SET THIS`).
3. Create `invoice-api-secrets` from `k8s/secrets/prod.env` with your MongoDB Atlas URI and new JWT secrets.
4. `kubectl apply -k k8s/production`
5. New version: change `newTag` in `k8s/base/kustomization.yaml` and re-apply. Roll back with
   `kubectl -n invoice-maker rollout undo deployment/invoice-api`.
6. Put the HTTPS URL in `mobile-client/api.config.json` and build a signed release:
   `cordova build android --release --buildConfig=C:\keys\build.json -- --packageType=bundle`.

## Security notes

- Passwords hashed with bcrypt (cost 12); 15-minute access tokens, 30-day revocable refresh tokens.
- Every sync query is scoped to the signed-in user; payloads validated with Zod; auth endpoints rate limited.
- API container runs as non-root with a read-only filesystem in Kubernetes; a `preStop` pause gives zero-downtime
  rolling updates, and the API waits for MongoDB instead of crash-looping.
- No secrets in the APK — it only contains the public API URL.

## Roadmap

Quotes/estimates, recurring invoices, overdue reminders, expense tracking, CSV export, app PIN, payment links.
