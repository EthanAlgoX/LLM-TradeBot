"""
Unit tests for trading action protocol normalization.
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.utils.action_protocol import normalize_action, is_open_action, is_close_action


def test_normalize_open_aliases():
    assert normalize_action("long") == "open_long"
    assert normalize_action("buy") == "open_long"
    assert normalize_action("short") == "open_short"
    assert normalize_action("sell") == "open_short"


def test_normalize_close_with_side():
    assert normalize_action("close_position", position_side="long") == "close_long"
    assert normalize_action("close", position_side="short") == "close_short"


def test_normalize_close_without_side_keeps_generic():
    assert normalize_action("close_position") == "close_position"


def test_normalize_invalid_defaults_to_wait():
    assert normalize_action("something_unknown") == "wait"


def test_action_classifiers():
    assert is_open_action("open_long")
    assert is_open_action("long")
    assert not is_open_action("wait")
    assert is_close_action("close_long")
    assert is_close_action("close_position")
