#!/usr/bin/env python3
"""
Direct MongoDB client for the `linkedin-ai` database.

Auth: MONGODB-OIDC with an Atlas service-account access token. No URI with
embedded username / password. The MongoClient is built from `host=`
explicitly, and `MONGODB_ATLAS_CLIENT_ID` + `MONGODB_ATLAS_CLIENT_SECRET`
are exchanged via OAuth2 `client_credentials` for a short-lived access
token that pymongo then presents to the cluster.

Secrets live in `backend/.env.local` (loaded via `python-dotenv`):
    MONGODB_HOST                        e.g. cluster0.psvmpm.mongodb.net
    MONGODB_DB_NAME                     e.g. linkedin-ai
    MONGODB_ATLAS_CLIENT_ID             mdb_sa_id_...
    MONGODB_ATLAS_CLIENT_SECRET         mdb_sa_sk_...
    MONGODB_OIDC_AUDIENCE               https://www.mongodb.com/cloud/atlas

Subcommands:
    ping                     - server-status round trip
    collections              - list collections in the DB
    count <collection>       - count docs, optionally filtered via --filter json
    find   <collection>      - dump docs (default limit 10), filter via --filter json
    insert <collection>      - insert one or more JSON docs from --doc or stdin
    upsert <collection>      - upsert by --filter json + --update json (or $set)
    delete <collection>      - delete matching docs (asks for confirmation unless --yes)

Examples:
    backend/tests/.venv/bin/python3 backend/tests/db_client.py ping
    backend/tests/.venv/bin/python3 backend/tests/db_client.py collections
    backend/tests/.venv/bin/python3 backend/tests/db_client.py count messages --filter '{"threadUrn":"thread-A"}'
    backend/tests/.venv/bin/python3 backend/tests/db_client.py find  messages --filter '{"threadUrn":"thread-A"}' --limit 5
    backend/tests/.venv/bin/python3 backend/tests/db_client.py insert messages --doc '{"threadUrn":"t","messageUrn":"m1","direction":"inbound","senderName":"x","content":"hi"}'
    backend/tests/.venv/bin/python3 backend/tests/db_client.py delete messages --filter '{"threadUrn":"thread-A"}' --yes

Required Atlas-side config:
    - The cluster must be MongoDB 7.0+ (so it supports MONGODB-OIDC).
    - Atlas must have an OIDC / federated-auth identity provider
      configured for the project (Atlas -> Project Settings ->
      Federated Identity). Until that's set up the connection will
      fail with `AuthenticationFailed` on the server side even though
      the access token is valid.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests  # type: ignore
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.auth_oidc import OIDCCallback, OIDCCallbackContext, OIDCCallbackResult
from pymongo.collection import Collection
from pymongo.errors import PyMongoError

# Resolve `backend/.env.local` relative to this file (backend/tests/).
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env.local"
load_dotenv(_ENV_PATH, override=False)

# Cache the access token in-process so a long-running script doesn't
# re-OAuth on every command.
_TOKEN_CACHE: dict[str, Any] = {"token": None, "expires_at": 0.0}


def _require_env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        sys.stderr.write(
            f"[db] FATAL: {name} is not set. Add it to {_ENV_PATH}.\n"
        )
        sys.exit(2)
    return val


def _host() -> str:
    return _require_env("MONGODB_HOST")


def _db_name() -> str:
    name = os.environ.get("MONGODB_DB_NAME")
    if name:
        return name
    sys.stderr.write(
        f"[db] FATAL: MONGODB_DB_NAME is not set. Add it to {_ENV_PATH}.\n"
    )
    sys.exit(2)


def _audience() -> str:
    return os.environ.get("MONGODB_OIDC_AUDIENCE", "https://www.mongodb.com/cloud/atlas")


def _access_token() -> str:
    """OAuth2 `client_credentials` -> short-lived access_token from the Atlas IdP.

    This is the IdP's token endpoint (`cloud.mongodb.com/api/oauth/token`),
    not the Atlas Admin API - it's the standard OAuth2 dance and is the
    only way to turn a service-account `client_id` + `client_secret`
    into something a MongoClient can use for `MONGODB-OIDC` auth.
    """
    now = time.time()
    if _TOKEN_CACHE["token"] and now < _TOKEN_CACHE["expires_at"] - 30:
        return _TOKEN_CACHE["token"]  # type: ignore[return-value]

    cid = _require_env("MONGODB_ATLAS_CLIENT_ID")
    csec = _require_env("MONGODB_ATLAS_CLIENT_SECRET")
    resp = requests.post(
        "https://cloud.mongodb.com/api/oauth/token",
        auth=(cid, csec),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data="grant_type=client_credentials",
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    _TOKEN_CACHE["token"] = body["access_token"]
    _TOKEN_CACHE["expires_at"] = now + int(body.get("expires_in", 3600))
    return body["access_token"]


class _AtlasServiceAccountCallback(OIDCCallback):
    """`OIDCCallback` subclass that mints access tokens via OAuth2 client_credentials.

    Pymongo's MONGODB-OIDC machinery accepts an instance of the
    `OIDCCallback` ABC (defined in `pymongo.auth_oidc`). We subclass it
    and implement the abstract `fetch()` method to do the
    service-account OAuth dance against `cloud.mongodb.com/api/oauth/token`
    on every call - pymongo calls fetch() whenever it needs a fresh token.
    """

    def fetch(self, context: OIDCCallbackContext) -> OIDCCallbackResult:
        # Force a fresh token on every fetch so pymongo never sees a
        # stale one (in particular on reconnect).
        _TOKEN_CACHE["token"] = None
        token = _access_token()
        return OIDCCallbackResult(access_token=token, expires_in_seconds=3600)


def _srv_uri() -> str:
    """Build a credential-free `mongodb+srv://` URI from `MONGODB_HOST`.

    The SRV URI scheme does the DNS lookup for the actual shard
    hostnames (e.g. `cluster0-shard-00-00.psvmpm.mongodb.net`). We
    deliberately do NOT embed a username / password in this string -
    auth is handled out-of-band by MONGODB-OIDC + the OIDCCallback.
    """
    host = _host()
    # mongodb+srv:// expects the bare hostname, no scheme prefix.
    bare = host.removeprefix("mongodb+srv://").removeprefix("mongodb://")
    bare = bare.split("/", 1)[0]  # strip any path/query
    return f"mongodb+srv://{bare}/?ssl=true&retryWrites=true&w=majority"


def _client() -> MongoClient:
    """Build a pymongo MongoClient authenticated via MONGODB-OIDC.

    The connection string is a credential-free `mongodb+srv://` URI;
    auth is handled out-of-band by MONGODB-OIDC + `_AtlasServiceAccountCallback`.
    """
    cid = _require_env("MONGODB_ATLAS_CLIENT_ID")
    return MongoClient(
        _srv_uri(),
        username=cid,  # required by pymongo for MONGODB-OIDC
        authMechanism="MONGODB-OIDC",
        authMechanismProperties={
            "OIDC_CALLBACK": _AtlasServiceAccountCallback(),
            "audience": _audience(),
        },
        serverSelectionTimeoutMS=10000,
        appname="linkedin-ai-tests/db_client.py",
    )


def _collection(name: str) -> Collection:
    return _client()[_db_name()][name]


def _parse_json_arg(value: str, what: str) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"[db] FATAL: invalid JSON for {what}: {e}\n")
        sys.exit(2)


# ----- subcommands --------------------------------------------------------


def cmd_ping(_args: argparse.Namespace) -> None:
    info = _client().admin.command("ping")
    print(json.dumps(
        {"ping": _jsonify(info), "db": _db_name(), "host": _host(), "auth": "MONGODB-OIDC"},
        indent=2,
        default=str,
    ))


def cmd_collections(_args: argparse.Namespace) -> None:
    db = _client()[_db_name()]
    print(json.dumps(
        {"db": db.name, "host": _host(), "collections": db.list_collection_names()},
        indent=2,
    ))


def cmd_count(args: argparse.Namespace) -> None:
    flt = _parse_json_arg(args.filter, "--filter") if args.filter else {}
    n = _collection(args.collection).count_documents(flt)
    out: dict[str, Any] = {"collection": args.collection, "filter": flt, "count": n}
    print(json.dumps(out, indent=2))


def cmd_find(args: argparse.Namespace) -> None:
    flt = _parse_json_arg(args.filter, "--filter") if args.filter else {}
    proj = _parse_json_arg(args.projection, "--projection") if args.projection else None
    cursor = (
        _collection(args.collection)
        .find(flt, proj)
        .sort(args.sort or "_id")
        .limit(args.limit)
    )
    docs = [_jsonify(d) for d in cursor]
    print(json.dumps(
        {"collection": args.collection, "filter": flt, "count": len(docs), "docs": docs},
        indent=2,
        default=str,
    ))


def cmd_insert(args: argparse.Namespace) -> None:
    if args.doc:
        docs = _parse_json_arg(args.doc, "--doc")
        if isinstance(docs, dict):
            docs = [docs]
        elif not isinstance(docs, list):
            sys.stderr.write("[db] FATAL: --doc must be a JSON object or array\n")
            sys.exit(2)
    else:
        raw = sys.stdin.read().strip()
        docs = _parse_json_arg(raw, "stdin")
        if isinstance(docs, dict):
            docs = [docs]
    res = _collection(args.collection).insert_many(docs, ordered=False)
    print(json.dumps(
        {"insertedIds": [_jsonify(_id) for _id in res.inserted_ids]},
        indent=2,
        default=str,
    ))


def cmd_upsert(args: argparse.Namespace) -> None:
    flt = _parse_json_arg(args.filter, "--filter")
    if not flt:
        sys.stderr.write("[db] FATAL: --filter required for upsert\n")
        sys.exit(2)
    upd_raw = _parse_json_arg(args.update, "--update") if args.update else None
    if upd_raw is None:
        sys.stderr.write("[db] FATAL: --update required for upsert\n")
        sys.exit(2)
    update_doc = {"$set": upd_raw} if not any(k.startswith("$") for k in upd_raw) else upd_raw
    res = _collection(args.collection).update_one(flt, update_doc, upsert=True)
    out = {
        "matchedCount": res.matched_count,
        "modifiedCount": res.modified_count,
        "upsertedId": _jsonify(res.upserted_id) if res.upserted_id else None,
    }
    print(json.dumps(out, indent=2, default=str))


def cmd_delete(args: argparse.Namespace) -> None:
    flt = _parse_json_arg(args.filter, "--filter")
    if not flt:
        sys.stderr.write("[db] FATAL: --filter required for delete (refuse to wipe the collection)\n")
        sys.exit(2)
    if not args.yes:
        sys.stderr.write(
            f"[db] refusing to delete without --yes. Filter: {json.dumps(flt)}\n"
        )
        sys.exit(2)
    res = _collection(args.collection).delete_many(flt)
    print(json.dumps({"deletedCount": res.deleted_count}, indent=2))


# ----- helpers ------------------------------------------------------------


def _jsonify(o: Any) -> Any:
    """ObjectId / datetime -> str so json.dumps works without `default=str`."""
    if hasattr(o, "__str__") and o.__class__.__name__ in {"ObjectId", "datetime"}:
        return str(o)
    if isinstance(o, dict):
        return {k: _jsonify(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_jsonify(v) for v in o]
    return o


# ----- main ---------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("ping").set_defaults(func=cmd_ping)
    sub.add_parser("collections").set_defaults(func=cmd_collections)

    p_count = sub.add_parser("count", help="count documents matching --filter")
    p_count.add_argument("collection")
    p_count.add_argument("--filter", default="", help="JSON filter, e.g. '{\"threadUrn\":\"thread-A\"}'")
    p_count.set_defaults(func=cmd_count)

    p_find = sub.add_parser("find", help="dump documents matching --filter")
    p_find.add_argument("collection")
    p_find.add_argument("--filter", default="")
    p_find.add_argument("--projection", default="")
    p_find.add_argument("--limit", type=int, default=10)
    p_find.add_argument("--sort", default=None, help="field name to sort by")
    p_find.set_defaults(func=cmd_find)

    p_ins = sub.add_parser("insert", help="insert one or many documents")
    p_ins.add_argument("collection")
    p_ins.add_argument("--doc", default="", help="JSON object or array; if omitted reads stdin")
    p_ins.set_defaults(func=cmd_insert)

    p_up = sub.add_parser("upsert", help="upsert one document matching --filter")
    p_up.add_argument("collection")
    p_up.add_argument("--filter", required=True)
    p_up.add_argument("--update", required=True)
    p_up.set_defaults(func=cmd_upsert)

    p_del = sub.add_parser("delete", help="delete many matching --filter (requires --yes)")
    p_del.add_argument("collection")
    p_del.add_argument("--filter", required=True)
    p_del.add_argument("--yes", action="store_true")
    p_del.set_defaults(func=cmd_delete)

    args = parser.parse_args()
    try:
        args.func(args)
    except PyMongoError as e:
        sys.stderr.write(f"[db] ERROR: {e.__class__.__name__}: {e}\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
