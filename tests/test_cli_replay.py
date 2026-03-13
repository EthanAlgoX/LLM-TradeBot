from cli import _build_stage_summary, _extract_execution_resolutions


def test_build_stage_summary_counts_and_duration():
    events = [
        {"seq": 0, "ts": "2026-03-05T00:00:00+00:00", "stage": "selector", "phase": "start", "agent": "a", "data": {}},
        {"seq": 1, "ts": "2026-03-05T00:00:01+00:00", "stage": "selector", "phase": "end", "agent": "a", "data": {}},
        {"seq": 2, "ts": "2026-03-05T00:00:02+00:00", "stage": "risk", "phase": "start", "agent": "b", "data": {}},
        {"seq": 3, "ts": "2026-03-05T00:00:03+00:00", "stage": "risk", "phase": "end", "agent": "b", "data": {}},
    ]

    out = _build_stage_summary(events)

    assert len(out) == 2
    assert out[0]["stage"] == "selector"
    assert out[0]["event_count"] == 2
    assert out[0]["start_count"] == 1
    assert out[0]["end_count"] == 1
    assert out[0]["duration_ms"] == 1000

    assert out[1]["stage"] == "risk"
    assert out[1]["duration_ms"] == 1000


def test_build_stage_summary_handles_invalid_ts():
    events = [
        {"seq": 0, "ts": "bad-ts", "stage": "selector", "phase": "start", "agent": "a", "data": {}},
        {"seq": 1, "ts": "2026-03-05T00:00:01+00:00", "stage": "selector", "phase": "end", "agent": "a", "data": {}},
    ]

    out = _build_stage_summary(events)
    assert len(out) == 1
    assert out[0]["duration_ms"] is None


def test_extract_execution_resolutions_flattens_resolution_events():
    events = [
        {
            "seq": 7,
            "ts": "2026-03-05T00:00:07+00:00",
            "stage": "execution_resolution",
            "phase": "end",
            "agent": "execution_agent",
            "data": {
                "planned_action": {"symbol": "BTCUSDT", "action": "open_long"},
                "resolutions": [
                    {
                        "kind": "cancel_conflicting_pending_order",
                        "resolution_action": {"action": "cancel_order", "symbol": "BTCUSDT"},
                        "resolution_result": {"status": "success", "message": "active order canceled"},
                    }
                ],
            },
        }
    ]

    out = _extract_execution_resolutions(events)

    assert out == [
        {
            "seq": 7,
            "ts": "2026-03-05T00:00:07+00:00",
            "symbol": "BTCUSDT",
            "planned_action": "open_long",
            "kind": "cancel_conflicting_pending_order",
            "resolution_action": {"action": "cancel_order", "symbol": "BTCUSDT"},
            "resolution_result": {"status": "success", "message": "active order canceled"},
        }
    ]
