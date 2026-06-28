# Backend smoke tests

`smoke_test.py` hits every public endpoint on the running backend, exercises
happy paths + the most common validation errors, and writes:

- `results.md` — human-readable Markdown report.
- `raw.json` — structured dump of every request/response for machine use.

## Run

```bash
# 1. Make sure the backend is up:
cd backend && npm run dev    # or: node dist/index.js

# 2. Run the tests:
python3 backend/tests/smoke_test.py

# Optional flags:
python3 backend/tests/smoke_test.py --base http://localhost:3000
python3 backend/tests/smoke_test.py --keep-data   # don't wipe test rows
LINKEDIN_AI_BACKEND=http://localhost:3000 python3 backend/tests/smoke_test.py
```

Exit code is `0` when every assertion passes, `1` otherwise.

## What it covers

| Section | Endpoints |
|---|---|
| 1. Health | `GET /health` |
| 2. Messages POST happy path | `POST /api/messages` (insert + re-upsert + second thread) |
| 3. Messages POST validation | `POST /api/messages` (missing field, empty array, bad enum) |
| 4. Messages GET | `GET /api/messages` (happy + 400 + unknown thread) |
| 5. Threads | `GET /api/threads` (limit clamp, 404) |
| 6. Feedback POST | `POST /api/feedback` (happy + score range + missing field) |
| 7. Feedback GET | `GET /api/feedback` (happy + 400 + unknown thread) |
| 8. Draft | `POST /api/draft` (real Gemini call + 400 paths) |
| 9. Agent stub | `POST /api/agent/decide` (501), `GET /api/agent/status` |
| 10. 404 catch-all | unknown route |

## Why one of the `/api/draft` cases is expected to fail locally

`/api/draft` makes a real Gemini call. With the placeholder
`GEMINI_API_KEY` shipped in `backend/.env.local`, Gemini responds 401/403
and the route returns 500 with `success: false`. The smoke test records
this as FAIL on purpose so you can see the placeholder-key behaviour in
the report. Drop a real key into `backend/.env.local`, restart the
backend, and the case flips to PASS.

## DB cleanup

The script deletes test rows for `thread-A` and `thread-B` before and
after the run. It uses `mongosh` from `$PATH` if available; otherwise it
skips cleanup (you'll see `[smoke] NOTE: mongosh not on PATH`). To clean
up manually:

```bash
mongosh --eval '
  db = db.getSiblingDB("linkedin-ai");
  db.messages.deleteMany({threadUrn: {$in: ["thread-A","thread-B"]}});
  db.threads.deleteMany({urn:        {$in: ["thread-A","thread-B"]}});
  db.feedback.deleteMany({threadUrn: {$in: ["thread-A","thread-B"]}});
'
```

Or with the bundled Atlas Admin API helper:

```bash
python3 backend/tests/atlas_api.py ...   # see below
```

## Helpers for MongoDB Atlas

Two small helpers live in this folder. None of them talk to MongoDB via
raw HTTP - everything goes through a proper client library, and every
secret is read from `backend/.env.local` via `python-dotenv` (no argv, no
shell history).

- `set_atlas_uri.py` — rewrites the `MONGODB_URI=` line in
  `backend/.env.local` from stdin (one URI per call). The **backend**
  (mongoose) still uses a username/password URI for its connection; this
  helper is only here so the backend's URI can be swapped without
  leaking the password into shell history. The test code (see below)
  does **not** use a URI.

  ```bash
  python3 backend/tests/set_atlas_uri.py <<'EOF'
  mongodb+srv://USER:PASS@cluster0.psvmpm.mongodb.net/linkedin-ai?appName=Cluster0&authSource=admin
  EOF
  ```

- `db_client.py` — direct CRUD via `pymongo` (the official MongoDB
  driver) against the `linkedin-ai` database.

  **Auth: MONGODB-OIDC with the Atlas service account.** The test code
  does **not** use a connection URI with embedded credentials. It
  builds the MongoClient from a credential-free `mongodb+srv://` URI
  (just the hostname, so DNS-SRV can resolve the shard list) and
  authenticates via `MONGODB-OIDC` + a `pymongo.auth_oidc.OIDCCallback`
  subclass that exchanges `MONGODB_ATLAS_CLIENT_ID` +
  `MONGODB_ATLAS_CLIENT_SECRET` for a short-lived OAuth2 access token
  on every fetch. No password, no DB-user, no SRV string with
  `user:pass@host` - just `client_id` + `client_secret`.

  Subcommands: `ping`, `collections`, `count`, `find`, `insert`,
  `upsert`, `delete`.

  ```bash
  python3 backend/tests/db_client.py ping
  python3 backend/tests/db_client.py collections
  python3 backend/tests/db_client.py count messages --filter '{"threadUrn":"thread-A"}'
  python3 backend/tests/db_client.py find   messages --filter '{"threadUrn":"thread-A"}' --limit 5
  python3 backend/tests/db_client.py insert messages --doc '{"threadUrn":"t","messageUrn":"m1","direction":"inbound","senderName":"x","content":"hi"}'
  python3 backend/tests/db_client.py delete messages --filter '{"threadUrn":"thread-A"}' --yes
  ```

### Atlas-side config required for `db_client.py` to work

The client-side code is correct, but **MONGODB-OIDC auth also requires
the cluster itself to be configured for OIDC**. Until that is set up,
`db_client.py` will fail with `Authentication failed` even though the
access token is being minted and sent correctly.

Steps on Atlas:
1. Project -> Security -> Authentication -> **Set up an OIDC / Federated
   Identity provider** that points at the same IdP that issued the
   service-account token (cloud.mongodb.com).
2. Add an OIDC-enabled database user with `oidcAuthType: IDP_GROUP`
   (or `USER`) mapped to the right IdP claim.
3. Confirm the audience in the token (`aud`) matches what
   `MONGODB_OIDC_AUDIENCE` is set to (default
   `https://www.mongodb.com/cloud/atlas`).

Until those are done, the backend (which uses the username/password
URI) is the only thing that can talk to the cluster.

### One-time Atlas wiring (what we did)

1. Whitelisted this machine's public IP on the **project** access list:
   `python3 backend/tests/atlas_api.py add-access $(curl -sS https://api.ipify.org)`.
   (Note: this is a different list from the cluster-scoped one and from the
   org-level API access list. Project-level is what governs `mongodb+srv://`
   connections from this box.)
2. Reset the `muditjai` user's password via PATCH
   `/api/atlas/v2/groups/{groupId}/databaseUsers/admin/muditjai` so we
   had a known-good value to put in the URI.
3. Wrote the new URI (including `authSource=admin&retryWrites=true&w=majority`)
   to `backend/.env.local` via `set_atlas_uri.py`.
4. Restarted the backend; it picked up the new env and connected.

## Dependencies

This folder ships its own Python virtualenv at `backend/tests/.venv`
(gitignored) so the test scripts are self-contained:

```bash
# Recreate the venv if missing:
cd backend/tests
python3 -m venv .venv
.venv/bin/pip install python-dotenv pymongo requests
```

After that, always invoke the scripts via `backend/tests/.venv/bin/python3`
so they pick up `python-dotenv` + `pymongo` + `requests`:

```bash
backend/tests/.venv/bin/python3 backend/tests/smoke_test.py
backend/tests/.venv/bin/python3 backend/tests/db_client.py ping
backend/tests/.venv/bin/python3 backend/tests/db_client.py collections
backend/tests/.venv/bin/python3 backend/tests/db_client.py count messages --filter '{"threadUrn":"thread-A"}'
backend/tests/.venv/bin/python3 backend/tests/db_client.py find  messages --filter '{"threadUrn":"thread-A"}' --limit 5
backend/tests/.venv/bin/python3 backend/tests/db_client.py insert messages --doc '{"threadUrn":"t","messageUrn":"m1","direction":"inbound","senderName":"x","content":"hi"}'
backend/tests/.venv/bin/python3 backend/tests/db_client.py delete messages --filter '{"threadUrn":"thread-A"}' --yes
```

Or use the system `python3` if you already have `requests`, `pymongo`,
and `python-dotenv` installed globally — the scripts only require those
three packages.

## Required `.env.local` keys (for `db_client.py`)

| Var | Used for | Example |
|---|---|---|
| `MONGODB_HOST` | SRV lookup base | `cluster0.psvmpm.mongodb.net` |
| `MONGODB_DB_NAME` | target DB | `linkedin-ai` |
| `MONGODB_ATLAS_CLIENT_ID` | service account | `mdb_sa_id_...` |
| `MONGODB_ATLAS_CLIENT_SECRET` | service account | `mdb_sa_sk_...` |
| `MONGODB_OIDC_AUDIENCE` | OAuth audience (optional) | `https://www.mongodb.com/cloud/atlas` |

The backend also needs `MONGODB_URI` (mongoose uses it). The two are
intentionally separate - the backend keeps using a username/password
URI, while the test code uses the service-account OIDC flow above.
