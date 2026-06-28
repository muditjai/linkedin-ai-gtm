#!/usr/bin/env python3
"""
LinkedIn AI GTM - Backend Smoke Test
====================================

Hits every public endpoint on the running backend, exercises happy paths
plus the most common validation errors, and writes a Markdown report to
`results.md` (sibling of this file) plus a structured JSON dump to
`raw.json` for machine consumption.

Run from anywhere:
    python3 backend/tests/smoke_test.py
    python3 backend/tests/smoke_test.py --base http://localhost:3000

The script is idempotent: it deletes any pre-existing rows for the test
threads (`thread-A`, `thread-B`) in the linkedin-ai database before it
runs, and re-deletes them after, so re-running won't accumulate data.

Exit code is 0 when every assertion passes, 1 otherwise.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

try:
    import requests  # type: ignore
except ImportError:  # pragma: no cover - the env has it but be defensive
    print("[smoke] FATAL: this script needs the `requests` package", file=sys.stderr)
    sys.exit(2)

# --------------------------------------------------------------------------
# Paths & defaults.
# --------------------------------------------------------------------------

HERE = Path(__file__).resolve().parent
RESULTS_MD = HERE / "results.md"
RAW_JSON = HERE / "raw.json"

DEFAULT_BASE = os.environ.get("LINKEDIN_AI_BACKEND", "http://localhost:3000")
TEST_THREADS = ["thread-A", "thread-B"]


# --------------------------------------------------------------------------
# Result accumulator.
# --------------------------------------------------------------------------


@dataclass
class CaseResult:
    section: str
    name: str
    method: str
    path: str
    expected_status: int
    actual_status: Optional[int]
    body: Any
    elapsed_ms: float
    error: Optional[str] = None


@dataclass
class Run:
    base: str
    started_at: str
    finished_at: str = ""
    cases: list[CaseResult] = field(default_factory=list)

    def add(self, c: CaseResult) -> None:
        self.cases.append(c)

    @property
    def passed(self) -> int:
        return sum(1 for c in self.cases if c.actual_status == c.expected_status)

    @property
    def failed(self) -> int:
        return sum(1 for c in self.cases if c.actual_status != c.expected_status)


# --------------------------------------------------------------------------
# HTTP helper.
# --------------------------------------------------------------------------


def _hit(base: str, method: str, path: str, body: Any, timeout: float) -> CaseResult:
    """One HTTP call. Never raises - errors become a CaseResult with status=None."""
    url = f"{base}{path}"
    started = time.perf_counter()
    try:
        resp = requests.request(
            method=method,
            url=url,
            json=body if body is not None else None,
            timeout=timeout,
            headers={"Accept": "application/json"},
        )
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        try:
            parsed: Any = resp.json()
        except ValueError:
            parsed = resp.text
        return CaseResult(
            section="",
            name="",
            method=method,
            path=path,
            expected_status=0,
            actual_status=resp.status_code,
            body=parsed,
            elapsed_ms=elapsed_ms,
        )
    except requests.RequestException as e:
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        return CaseResult(
            section="",
            name="",
            method=method,
            path=path,
            expected_status=0,
            actual_status=None,
            body=None,
            elapsed_ms=elapsed_ms,
            error=str(e),
        )


def hit(
    run: Run,
    section: str,
    name: str,
    method: str,
    path: str,
    expected_status: int,
    body: Any = None,
    timeout: float = 30.0,
) -> CaseResult:
    """Convenience wrapper that fills in section+name and appends to the run."""
    res = _hit(run.base, method, path, body, timeout)
    res.section = section
    res.name = name
    res.expected_status = expected_status
    run.add(res)
    return res


# --------------------------------------------------------------------------
# Mongo cleanup via mongosh subprocess (pymongo is not installed in env).
# --------------------------------------------------------------------------


def _mongosh_cleanup() -> None:
    """Delete any pre-existing test rows. Best-effort; never raises."""
    if shutil.which("mongosh") is None:
        print("[smoke] NOTE: mongosh not on PATH - skipping DB cleanup", file=sys.stderr)
        return
    script = (
        'db.getSiblingDB("linkedin-ai").messages.deleteMany('
        f'{{threadUrn: {{$in: {json.dumps(TEST_THREADS)}}}}}); '
        'db.getSiblingDB("linkedin-ai").threads.deleteMany('
        f'{{urn: {{$in: {json.dumps(TEST_THREADS)}}}}}); '
        'db.getSiblingDB("linkedin-ai").feedback.deleteMany('
        f'{{threadUrn: {{$in: {json.dumps(TEST_THREADS)}}}}});'
    )
    try:
        subprocess.run(
            ["mongosh", "--quiet", "--eval", script],
            timeout=10,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass


# --------------------------------------------------------------------------
# Markdown rendering.
# --------------------------------------------------------------------------


def _fmt_body(body: Any) -> str:
    if body is None:
        return "_(no response body)_"
    if isinstance(body, (dict, list)):
        try:
            return "```json\n" + json.dumps(body, indent=2, sort_keys=True) + "\n```"
        except (TypeError, ValueError):
            return f"```\n{body!r}\n```"
    return f"```\n{body}\n```"


def render_markdown(run: Run) -> str:
    lines: list[str] = []
    lines.append("# LinkedIn AI GTM - Backend Smoke Test Report")
    lines.append("")
    lines.append(f"- **Base URL:** `{run.base}`")
    lines.append(f"- **Run started:** {run.started_at}")
    lines.append(f"- **Run finished:** {run.finished_at}")
    lines.append("- **Test threads:** " + ", ".join(f"`{t}`" for t in TEST_THREADS))
    lines.append("- **MongoDB:** `mongodb://localhost:27017` (local mongod)")
    lines.append("")

    # Per-section grouping preserves the order cases were added.
    sections: list[str] = []
    by_section: dict[str, list[CaseResult]] = {}
    for c in run.cases:
        if c.section not in by_section:
            by_section[c.section] = []
            sections.append(c.section)
        by_section[c.section].append(c)

    for sec in sections:
        lines.append(f"## {sec}")
        lines.append("")
        for c in by_section[sec]:
            ok = c.actual_status == c.expected_status and c.error is None
            badge = "PASS" if ok else "FAIL"
            lines.append(f"### `{c.method} {c.path}` - {c.name}")
            lines.append("")
            if c.error is not None:
                lines.append(f"- **Status:** _request failed_ `{c.error}`")
            else:
                lines.append(
                    f"- **Status:** `{c.actual_status}` "
                    f"(expected `{c.expected_status}`) - **{badge}**"
                )
            lines.append(f"- **Elapsed:** {c.elapsed_ms:.1f} ms")
            lines.append("")
            lines.append(_fmt_body(c.body))
            lines.append("")

    lines.append("## Summary")
    lines.append("")
    lines.append("| Metric | Count |")
    lines.append("|---|---:|")
    lines.append(f"| Total | {len(run.cases)} |")
    lines.append(f"| Passed | {run.passed} |")
    lines.append(f"| Failed | {run.failed} |")
    lines.append("")
    if run.failed == 0:
        lines.append("> All assertions passed.")
    else:
        lines.append(f"> {run.failed} assertion(s) failed - see `raw.json` for full payloads.")
    lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Test cases.
# --------------------------------------------------------------------------


def _mk_msg(urn: str, direction: str, sender: str, content: str, ts: str, sent_at: str) -> dict:
    return {
        "messageUrn": urn,
        "direction": direction,
        "senderName": sender,
        "content": content,
        "timestamp": ts,
        "sentAt": sent_at,
    }


def run_all(base: str) -> Run:
    started = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S %Z")
    run = Run(base=base, started_at=started)

    _mongosh_cleanup()

    sent_at_a1 = "2026-06-28T17:01:00.000Z"
    sent_at_a2 = "2026-06-28T17:05:00.000Z"
    sent_at_a3 = "2026-06-28T17:07:00.000Z"
    sent_at_a4 = "2026-06-28T17:09:00.000Z"

    # ---- 1. Health -------------------------------------------------------
    hit(run, "1. Health", "health", "GET", "/health", 200)

    # ---- 2. /api/messages POST (happy path) ------------------------------
    hit(
        run,
        "2. /api/messages POST - happy path",
        "insert 3 msgs into thread-A",
        "POST",
        "/api/messages",
        200,
        body={
            "threadUrn": "thread-A",
            "conversationName": "Alice Smith",
            "conversationUrl": "https://www.linkedin.com/in/alice-smith",
            "messages": [
                _mk_msg("msg-1", "inbound", "Alice", "Hey, are you free Thursday for a quick sync?", "10:01 AM", sent_at_a1),
                _mk_msg("msg-2", "outbound", "Me",    "Yes - 2pm works. Want me to bring anything?",   "10:05 AM", sent_at_a2),
                _mk_msg("msg-3", "inbound", "Alice", "Just bring yourself. Coffee is on me.",         "10:07 AM", sent_at_a3),
            ],
        },
    )

    # Re-upsert: msg-2 + msg-3 already exist; msg-4 is new.
    hit(
        run,
        "2. /api/messages POST - happy path",
        "re-upsert msg-2/3 + new msg-4",
        "POST",
        "/api/messages",
        200,
        body={
            "threadUrn": "thread-A",
            "conversationName": "Alice Smith",
            "messages": [
                _mk_msg("msg-2", "outbound", "Me",    "Yes - 2pm works.",                       "10:05 AM", sent_at_a2),
                _mk_msg("msg-3", "inbound", "Alice", "Just bring yourself.",                   "10:07 AM", sent_at_a3),
                _mk_msg("msg-4", "inbound", "Alice", "Also, can you review my deck beforehand?", "10:09 AM", sent_at_a4),
            ],
        },
    )

    # Second thread for the threads listing test.
    hit(
        run,
        "2. /api/messages POST - happy path",
        "insert 2 msgs into thread-B",
        "POST",
        "/api/messages",
        200,
        body={
            "threadUrn": "thread-B",
            "conversationName": "Bob Jones",
            "messages": [
                _mk_msg("msg-1", "inbound",  "Bob", "Saw your post - loved it.", "9:00 AM", "2026-06-28T16:00:00.000Z"),
                _mk_msg("msg-2", "outbound", "Me",  "Thanks Bob!",                "9:30 AM", "2026-06-28T16:30:00.000Z"),
            ],
        },
    )

    # ---- 3. /api/messages POST validation errors -------------------------
    hit(
        run,
        "3. /api/messages POST - validation errors",
        "missing threadUrn",
        "POST",
        "/api/messages",
        400,
        body={
            "conversationName": "Bad",
            "messages": [{"messageUrn": "x", "direction": "inbound", "senderName": "x", "content": "x"}],
        },
    )
    hit(
        run,
        "3. /api/messages POST - validation errors",
        "empty messages array",
        "POST",
        "/api/messages",
        400,
        body={"threadUrn": "thread-A", "conversationName": "Alice", "messages": []},
    )
    hit(
        run,
        "3. /api/messages POST - validation errors",
        "bad direction enum",
        "POST",
        "/api/messages",
        400,
        body={
            "threadUrn": "thread-A",
            "conversationName": "Alice",
            "messages": [{"messageUrn": "msg-bad", "direction": "sideways", "senderName": "x", "content": "x"}],
        },
    )

    # ---- 4. /api/messages GET --------------------------------------------
    hit(run, "4. /api/messages GET - read messages", "list thread-A", "GET", "/api/messages?threadUrn=thread-A", 200)
    hit(run, "4. /api/messages GET - read messages", "list thread-B", "GET", "/api/messages?threadUrn=thread-B", 200)
    hit(run, "4. /api/messages GET - read messages", "missing threadUrn -> 400", "GET", "/api/messages", 400)
    hit(run, "4. /api/messages GET - read messages", "unknown thread -> 200 empty", "GET", "/api/messages?threadUrn=does-not-exist", 200)

    # ---- 5. /api/threads -------------------------------------------------
    hit(run, "5. /api/threads", "list top threads (limit=15)", "GET", "/api/threads?limit=15", 200)
    hit(run, "5. /api/threads", "list top threads (limit=1)",  "GET", "/api/threads?limit=1", 200)
    hit(run, "5. /api/threads", "limit clamped to 100",         "GET", "/api/threads?limit=999", 200)
    hit(run, "5. /api/threads", "fetch single thread-A",         "GET", "/api/threads/thread-A", 200)
    hit(run, "5. /api/threads", "fetch missing thread -> 404",   "GET", "/api/threads/does-not-exist", 404)

    # ---- 6. /api/feedback POST ------------------------------------------
    hit(
        run,
        "6. /api/feedback POST",
        "submit feedback 5/5",
        "POST",
        "/api/feedback",
        200,
        body={
            "threadUrn": "thread-A",
            "messageUrn": "msg-4",
            "draft": "Happy to take a look - sending notes by EOD Thursday.",
            "sentiment": "positive",
            "score": 5,
            "comment": "Tone matches my usual voice, good call to action.",
            "model": "gemini-3.1-pro",
        },
    )
    hit(
        run,
        "6. /api/feedback POST",
        "submit feedback 2/5",
        "POST",
        "/api/feedback",
        200,
        body={
            "threadUrn": "thread-A",
            "messageUrn": "msg-3",
            "draft": "Sounds good!",
            "sentiment": "positive",
            "score": 2,
            "comment": "Too short, add a concrete next step.",
            "model": "gemini-3.1-pro",
        },
    )
    hit(
        run,
        "6. /api/feedback POST",
        "submit feedback 4/5 with empty messageUrn",
        "POST",
        "/api/feedback",
        200,
        body={
            "threadUrn": "thread-A",
            "messageUrn": "",
            "draft": "Another draft for thread-A.",
            "sentiment": "neutral",
            "score": 4,
            "comment": "Fine but a little stiff.",
            "model": "gemini-3.1-pro",
        },
    )
    hit(run, "6. /api/feedback POST", "score=0 below min -> 400", "POST", "/api/feedback", 400, body={"threadUrn": "thread-A", "score": 0})
    hit(run, "6. /api/feedback POST", "score=6 above max -> 400", "POST", "/api/feedback", 400, body={"threadUrn": "thread-A", "score": 6})
    hit(run, "6. /api/feedback POST", "missing threadUrn -> 400", "POST", "/api/feedback", 400, body={"score": 3})

    # ---- 7. /api/feedback GET -------------------------------------------
    hit(run, "7. /api/feedback GET", "list feedback for thread-A",  "GET", "/api/feedback?threadUrn=thread-A", 200)
    hit(run, "7. /api/feedback GET", "missing threadUrn -> 400",    "GET", "/api/feedback", 400)
    hit(run, "7. /api/feedback GET", "unknown thread -> 200 empty", "GET", "/api/feedback?threadUrn=does-not-exist", 200)

    # ---- 8. /api/draft --------------------------------------------------
    # Real Gemini call. With a placeholder key in .env.local this will fail
    # with 500, which is the documented behaviour - we accept either:
    #   200  (real key)  -> a real draft
    #   500  (fake key)  -> success:false with a Gemini auth error
    # Assert only that the route is wired and returns well-formed JSON.
    draft_body = {
        "threadUrn": "thread-A",
        "profile": "Alice is a PM at a Series B SaaS startup in SF. We met at a NYC AI meetup.",
        "lastMessageUrn": "msg-4",
        "messages": [
            _mk_msg("msg-1", "inbound",  "Alice", "Hey, are you free Thursday for a quick sync?",            "10:01 AM", sent_at_a1),
            _mk_msg("msg-2", "outbound", "Me",    "Yes - 2pm works. Want me to bring anything?",              "10:05 AM", sent_at_a2),
            _mk_msg("msg-3", "inbound",  "Alice", "Just bring yourself. Coffee is on me.",                    "10:07 AM", sent_at_a3),
            _mk_msg("msg-4", "inbound",  "Alice", "Also, can you review my deck beforehand?",                 "10:09 AM", sent_at_a4),
        ],
    }
    res = _hit(run.base, "POST", "/api/draft", draft_body, timeout=60.0)
    res.section = "8. /api/draft"
    res.name = "draft reply (real Gemini call)"
    # Accept either 200 or 500 - the route exists and returns JSON either way.
    # Expected status is recorded as 200; 500 will show up as FAIL and the
    # body will explain why (placeholder key vs quota vs network).
    res.expected_status = 200
    run.add(res)

    hit(run, "8. /api/draft", "empty messages -> 400", "POST", "/api/draft", 400, body={"threadUrn": "thread-A", "messages": []})
    hit(run, "8. /api/draft", "missing threadUrn -> 400", "POST", "/api/draft", 400, body={"messages": [{"messageUrn": "x", "direction": "inbound", "senderName": "x", "content": "x"}]})

    # ---- 9. /api/agent --------------------------------------------------
    hit(run, "9. /api/agent (LangGraph stub)", "POST /decide returns 501", "POST", "/api/agent/decide", 501, body={"threadUrn": "thread-A", "candidates": []})
    hit(run, "9. /api/agent (LangGraph stub)", "GET /status", "GET", "/api/agent/status", 200)

    # ---- 10. 404 catch-all ----------------------------------------------
    hit(run, "10. 404 catch-all", "unknown route", "GET", "/api/this-does-not-exist", 404)

    run.finished_at = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S %Z")
    return run


# --------------------------------------------------------------------------
# Main.
# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=DEFAULT_BASE, help="Backend base URL")
    parser.add_argument("--keep-data", action="store_true", help="Skip DB cleanup (leave rows behind)")
    args = parser.parse_args()

    print(f"[smoke] base URL: {args.base}")
    print(f"[smoke] results:  {RESULTS_MD}")
    print(f"[smoke] raw JSON: {RAW_JSON}")
    print("[smoke] running tests...")

    run = run_all(args.base)

    # Clean up afterwards unless the user asked to keep it.
    if not args.keep_data:
        _mongosh_cleanup()

    # Persist artefacts.
    RESULTS_MD.write_text(render_markdown(run))
    RAW_JSON.write_text(
        json.dumps(
            {
                "base": run.base,
                "started_at": run.started_at,
                "finished_at": run.finished_at,
                "passed": run.passed,
                "failed": run.failed,
                "total": len(run.cases),
                "cases": [
                    {
                        "section": c.section,
                        "name": c.name,
                        "method": c.method,
                        "path": c.path,
                        "expected_status": c.expected_status,
                        "actual_status": c.actual_status,
                        "elapsed_ms": round(c.elapsed_ms, 2),
                        "error": c.error,
                        "body": c.body,
                    }
                    for c in run.cases
                ],
            },
            indent=2,
            default=str,
        )
    )

    print()
    print(f"[smoke] {len(run.cases)} tests | passed={run.passed} failed={run.failed}")
    print(f"[smoke] report -> {RESULTS_MD}")
    print(f"[smoke] raw    -> {RAW_JSON}")

    # Per-case one-line summary so the user can spot failures fast.
    for c in run.cases:
        badge = "PASS" if c.actual_status == c.expected_status and c.error is None else "FAIL"
        print(f"  [{badge}] {c.method:6s} {c.path:55s} expected={c.expected_status} got={c.actual_status}  ({c.elapsed_ms:6.1f} ms)  - {c.name}")

    return 0 if run.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
