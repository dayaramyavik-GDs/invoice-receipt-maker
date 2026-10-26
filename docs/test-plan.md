# Test plan and results

Status key: ✅ passed · ⬜ not yet run · ➖ needs infrastructure not yet set up

## Automated

| Suite | Command | Result (2026-10-26) |
|---|---|---|
| API (11 tests, in-memory MongoDB) | `cd backend; npm test` | ✅ 11/11 |
| Lint | `cd backend; npm run lint` | ✅ clean |
| Mobile logic (7 tests) | `cd mobile-client; npm test` | ✅ 7/7 |
| Dependency audit | `npm audit --omit=dev` (both) | ✅ 0 vulnerabilities |
| Kubernetes manifests | `kubectl kustomize k8s/` + kubeconform | ✅ 9 valid, 1 skipped (ClusterIssuer CRD) |

## Offline app (browser dev server with SQLite shim)

| ID | Test | Result |
|---|---|---|
| OF-1 | First launch → onboarding; empty business name rejected | ✅ |
| OF-2 | Create customer (bad email rejected), item, invoice; issue → `INV-0001` | ✅ |
| OF-3 | Live totals: 3 × £19.99 @ 20% = £59.97 + £11.99 = £71.96 | ✅ |
| OF-4 | Issue blocked without customer / line description | ✅ |
| OF-5 | Part payment → "part paid"; mark paid → "paid" | ✅ |
| OF-6 | Receipt saved as paid (`REC-0001`, cash, walk-in customer) | ✅ |
| OF-7 | Delete draft → removed from list, tombstone queued | ✅ |
| OF-8 | Data persists after reload | ✅ |
| OF-9 | PDF: logo area, branded table, wrapped text, totals, payment block | ✅ |
| OF-10 | Same flows on a physical Android device in airplane mode | ⬜ |

## Sync (browser app ↔ API in Docker)

| ID | Test | Result |
|---|---|---|
| SY-1 | Register from the app → existing local data uploaded, outbox empty | ✅ |
| SY-2 | API stopped → edit → "Couldn't sync (1 waiting)" with retries | ✅ |
| SY-3 | API restarted → automatic retry → "All changes backed up", version bumped | ✅ |
| SY-4 | Conflict: other device adds payment, phone edits notes → both kept, version 3 on both sides, review banner | ✅ |
| SY-5 | Conflict review screen → "Keep current" clears it | ✅ |
| SY-6 | Second physical device pulls data | ⬜ |

## Docker

| ID | Test | Result |
|---|---|---|
| DK-1 | `docker compose ps` → both healthy | ✅ |
| DK-2 | Health, register, duplicate (409), push/pull, no token (401), bad JSON (400) via curl | ✅ |
| DK-3 | Production image runs as `node` user; bcrypt works on Alpine | ✅ |

## Kubernetes

| ID | Test | Result |
|---|---|---|
| K8-1 | Pods running, service, port-forward health | ➖ enable Kubernetes in Docker Desktop |
| K8-2 | Rolling update / rollback / self-healing / HPA | ➖ |
| K8-3 | HTTPS via Traefik + cert-manager | ➖ needs a cloud cluster and hostname |
