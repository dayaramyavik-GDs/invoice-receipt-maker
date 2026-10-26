# Architecture

## Where things run

| Place | What |
|---|---|
| Android device | UI, SQLite database, calculations, PDF generation, sync client |
| Docker (dev) | `api` (Express, live reload) + `mongo` (MongoDB 8 with a named volume) |
| Kubernetes | API Deployment (2–6 pods), Service, Ingress + TLS, ConfigMap, Secret, HPA |
| External | MongoDB Atlas, GHCR (images), Let's Encrypt, GitHub |

## Local data model (SQLite)

Each syncable table stores indexed columns for querying plus the full record as JSON in `data`:

| Table | Indexed columns |
|---|---|
| `business_profile` | – (single row, id `profile`) |
| `customers` | `name` |
| `items` | `name` |
| `documents` | `type`, `number`, `customer_id`, `status`, `issue_date`, `due_date`, `total_pence`, `paid_pence` |

All syncable tables also have `updated_at`, `version` (last server version) and `deleted_at` (tombstone).

Support tables: `outbox` (one pending change per record), `conflicts` (losing copies for review),
`meta` (schema version, sync cursor, tokens). Since schema v2 each syncable row also has `synced_data`
(the base for merges).

## Build-time API URL

`mobile-client/api.config.json` (or `API_ORIGIN`) is applied by the `after_prepare` hook
`scripts/apply-api-origin.js`, which writes `www/js/api-origin.js` and adds the origin to the CSP `connect-src` and
`<access>` in the platform copy. With no URL the app is offline-only and hides sign-in. `http://localhost` builds
also get a localhost-only cleartext rule for development via `adb reverse`.

## Kubernetes behaviour

- `preStop: sleep 10` keeps a terminating pod serving until the ingress stops routing to it. A rolling restart of
  6 pods under constant load served 191,506 requests with 0 errors. Without it, about 1% of requests failed
  with 502.
- The API starts its HTTP server first and retries MongoDB with backoff. `/health/ready` returns 503 until
  connected, so a MongoDB restart causes no API pod restarts.

Invoices/receipts embed their `lines`, `payments` and a `customer` snapshot so old PDFs stay accurate.
Money is integer pence; tax is rounded per line.

## Sync protocol

**Push** `POST /api/v1/sync/push` `{ changes: [{ opId, entity, id, baseVersion, updatedAt, deletedAt, data }] }`

Per change the server returns:
- `applied` with the new version (atomic compare-and-set on `version`)
- `duplicate` if `opId` was already applied (safe retries)
- `conflict` with the server copy
- `rejected` with a validation message

**Pull** `GET /api/v1/sync/pull?since=<serverSeq>` returns changed records in order of a per-user sequence
number, 200 per page. Records with pending local edits are skipped; records and the new cursor are saved in
one transaction.

**Order:** push, then pull. Triggered by:
- the `online` event
- app resume
- 3 s after a save
- every 5 minutes
- "Sync now"

Failures retry with exponential backoff (5 s → 5 min).

## Conflict policy (three-way merge)

Each local row keeps `synced_data`: the last copy it exchanged with the server. When a push is rejected because
another device changed the record first, `www/js/merge.js` compares local, server and that base field by field:

- Changed on only one device: that device's value is kept, so a note edited offline on one phone and a payment
  recorded on another both survive.
- Changed on both devices: the newest edit wins. For documents, the other copy is stored in `conflicts` for the
  user to review or restore.
- Payments are always combined by id, and totals are recalculated from the merged lines and payments.
- Records synced before schema v2 have no base yet, so they fall back to newest-wins until their next sync.

**Known limitations:**
- Device clocks decide last-write-wins.
- Two phones issuing invoices offline at the same time can pick the same number. Use a per-device prefix if
  that matters.

## Data-loss protection

- Record + outbox entry are written in one `sqlBatch` transaction.
- The outbox row is cleared only if its `op_id` still matches, so edits made during a sync are kept.
- The server is idempotent on `opId`.
- Deletes are soft (tombstones), so they sync.
- Manual JSON backup export.
