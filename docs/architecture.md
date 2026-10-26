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
`meta` (schema version, sync cursor, tokens).

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

## Conflict policy

- Profile, customers, items: newest `updatedAt` wins.
- Documents: payments from both sides are merged by id. The newest edit wins for everything else, and the
  losing copy is stored in `conflicts` for the user to review or restore.

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
