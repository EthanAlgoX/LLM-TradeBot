#!/usr/bin/env python3
"""Safe HTTP smoke test for the strategy-definition lifecycle.

It creates an isolated, timestamped strategy definition only; it never starts
an Agent run, fetches market data, or submits an order.  Every strategy made
by the smoke test is soft-archived before exit, so development screens do not
mistake smoke records for user strategies.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8000"


def request(method: str, path: str, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"{method} {path}: {exc.code} {exc.read().decode()}") from exc


def main():
    created_ids = []
    try:
        request("GET", "/api/health")
        suffix = int(time.time())
        templates = request("GET", "/api/v1/simulation/definition/agent-templates")
        assert templates, "Agent templates were not returned"
        request("GET", f"/api/v1/simulation/definition/agent-templates/{templates[0]['templateId']}")
        created = request("POST", "/api/v1/simulation/definition/strategies", {
            "name": f"smoke-definition-{suffix}", "description": "HTTP smoke lifecycle", "templateId": "trend-breakout",
        })
        created_ids.append(created["strategy"]["id"])
        draft = created["draft"]
        saved = request("PUT", f"/api/v1/simulation/definition/strategy-versions/{draft['id']}/draft", {
            "revision": draft["revision"], "strategy": {"name": created["strategy"]["name"]},
            "version": {"riskPolicy": {"decision_validity": {"max": "1d"}}},
            "agents": draft["agents"], "connections": draft["connections"],
        })
        # A stale revision must be rejected; the local preview is never persisted.
        try:
            request("PUT", f"/api/v1/simulation/definition/strategy-versions/{draft['id']}/draft", {"revision": draft["revision"], "agents": [], "connections": []})
            raise AssertionError("stale draft revision unexpectedly saved")
        except RuntimeError as exc:
            assert "VERSION_CONFLICT" in str(exc), exc
        preview = request("POST", f"/api/v1/simulation/definition/strategy-versions/{draft['id']}/diff-preview", {"localDraft": {"agents": [{**saved["draft"]["agents"][0], "name": "Local preview name"}]}})
        assert preview["preview"] is True
        fork = request("POST", f"/api/v1/simulation/definition/strategy-versions/{draft['id']}/fork-local", {
            "baseRevision": saved["revision"], "newStrategyName": f"smoke-local-copy-{suffix}",
            "newStrategyDescription": "conflict-local smoke copy", "localDraft": saved["draft"],
            "idempotencyKey": f"smoke-fork-{suffix}",
        })
        created_ids.append(fork["newStrategyId"])
        forked = request("GET", f"/api/v1/simulation/definition/strategy-versions/{fork['newDraftVersionId']}")
        assert {item["id"] for item in forked["agents"]}.isdisjoint({item["id"] for item in saved["draft"]["agents"]})
        assert {item["lineageId"] for item in forked["agents"]}.isdisjoint({item["lineageId"] for item in saved["draft"]["agents"]})
        check = request("POST", f"/api/v1/simulation/definition/strategy-versions/{draft['id']}/validate", {})
        assert check["valid"], check
        warnings = [item["code"] for item in check.get("warnings", [])]
        published = request("POST", f"/api/v1/simulation/definition/strategy-versions/{draft['id']}/publish", {"revision": saved["revision"], "changeLog": "HTTP smoke publication", "acknowledgedWarningCodes": warnings, "idempotencyKey": f"smoke-{suffix}"})
        cloned = request("POST", f"/api/v1/simulation/definition/strategies/{created['strategy']['id']}/drafts", {"basedOnVersionId": published["publishedVersionId"]})
        request("GET", f"/api/v1/simulation/definition/strategy-versions/{cloned['id']}/diff?against={published['publishedVersionId']}")
        request("GET", f"/api/v1/simulation/definition/strategies/{created['strategy']['id']}/audit-events")
        print("strategy-definition smoke passed")
    finally:
        for strategy_id in reversed(created_ids):
            try:
                request("POST", f"/api/v1/simulation/definition/strategies/{strategy_id}/archive")
            except Exception as exc:  # Keep the primary smoke failure visible.
                print(f"warning: failed to archive smoke strategy {strategy_id}: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
