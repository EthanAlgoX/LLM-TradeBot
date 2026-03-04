from cli import _build_stage_summary


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
