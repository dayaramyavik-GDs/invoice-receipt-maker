# Test plan and results

Status key: ✅ passed · ➖ needs infrastructure not yet set up (a public domain / cloud cluster)

Devices used: Pixel 9 Pro Fold (Android 17, current WebView) and an Android 15 emulator (WebView/Chrome 124).

## Automated

| Suite | Command | Result (2026-10-26) |
|---|---|---|
| API (11 tests, in-memory MongoDB) | `cd backend; npm test` | ✅ 11/11 |
| Lint | `cd backend; npm run lint` | ✅ clean |
| Mobile logic: money, tax, dates, statuses, sync merging | `cd mobile-client; npm test` | ✅ 14/14 |
| Dependency audit | `npm audit --omit=dev` (both) | ✅ 0 vulnerabilities |
| Kubernetes manifests (base, production, local) | `kubectl kustomize` + kubeconform | ✅ 15 valid, 1 skipped (ClusterIssuer CRD) |
| Secret scan of git history | gitleaks | ✅ no leaks |

## Offline app on a real phone (airplane mode, native SQLite)

| ID | Test | Result |
|---|---|---|
| OF-1 | Onboarding, customer, item | ✅ |
| OF-2 | Invoice issued as `INV-0001`, 3 × £19.99 @ 20% = £71.96 | ✅ |
| OF-3 | Part payment → "part paid" | ✅ |
| OF-4 | Receipt `REC-0001` saved as paid (cash) | ✅ |
| OF-5 | Dashboard totals (outstanding, received this month) | ✅ |
| OF-6 | **Share PDF opens the Android share sheet** with `INV-0001.pdf` (screenshot: `screenshots/03-share-sheet.png`) | ✅ |
| OF-7 | PDF generated on the phone is correct (pulled from the app cache and inspected) | ✅ |
| OF-8 | Data survives force-stop + app update in airplane mode | ✅ |
| OF-9 | Offline-only build (no API URL): sign-in hidden, settings explain it, everything else works | ✅ |

Found and fixed on the real devices:
- a blank band under the status bar (safe-area inset applied twice)
- line labels detached from their inputs
- the floating + button covering the last button
- a new screen opening part-way down because the previous screen's scroll position was kept

## Sync between two real devices (phone + emulator, API in Docker via `adb reverse`)

| ID | Test | Result |
|---|---|---|
| SY-1 | Register on the phone → data created offline uploads | ✅ |
| SY-2 | Second device signs in from the setup screen → gets profile, customers, invoices; skips setup | ✅ |
| SY-3 | Invoice created on the emulator appears on the phone; numbering continues (`INV-0002`, `INV-0003`) | ✅ |
| SY-4 | Change made on the phone appears on the emulator | ✅ |
| SY-5 | **Offline conflict:** emulator offline edits notes, phone records £30 payment → both kept on both devices (v3), no false conflict | ✅ |
| SY-6 | Same field edited on both → newest wins, other copy offered on the review screen (unit tested) | ✅ |
| SY-7 | API down → "Couldn't sync (1 waiting)" with retries; recovers automatically (browser run) | ✅ |

Found and fixed: Android blocked plain HTTP to the local API on the emulator (`ERR_CLEARTEXT_NOT_PERMITTED`).
Development builds now get a localhost-only exception. A second phone had no way to sign in from the setup screen.
An offline edit to a different field was lost in a conflict; this is now a three-way merge.

## Docker

| ID | Test | Result |
|---|---|---|
| DK-1 | `docker compose ps` → both healthy | ✅ |
| DK-2 | Health, register, duplicate (409), push/pull, no token (401), bad JSON (400) via curl | ✅ |
| DK-3 | Production image runs as `node` user; bcrypt works on Alpine | ✅ |

## Kubernetes (k3s v1.34 in Docker, Traefik ingress, metrics-server)

| ID | Test | Result |
|---|---|---|
| K8-1 | Deploy base + local MongoDB: 2 API pods Running, PVC Bound | ✅ |
| K8-2 | Health, register and sync through the Traefik ingress | ✅ |
| K8-3 | HPA scaled 2 → 6 under load and back to 2 when idle | ✅ |
| K8-4 | Rolling update under load: **0 errors in 191,506 requests** (after adding `preStop`; before: ~1% 502s) | ✅ |
| K8-5 | `rollout undo` to 0.1.0 and forward to 0.1.1 | ✅ |
| K8-6 | Deleted pod replaced automatically | ✅ |
| K8-7 | MongoDB pod restart: API reports not-ready (503), recovers with 0 restarts; data kept on the PVC | ✅ |
| K8-8 | Public HTTPS via cert-manager + Let's Encrypt | ➖ needs a cloud cluster and a domain |
