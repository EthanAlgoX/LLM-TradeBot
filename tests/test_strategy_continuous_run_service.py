from __future__ import annotations

from pathlib import Path

from src.services.strategy_continuous_run_service import StrategyContinuousRunService
from src.storage import DatabaseManager


def test_default_controller_rebinds_after_database_manager_reset(tmp_path: Path) -> None:
    StrategyContinuousRunService._instance = None
    DatabaseManager.reset_instance()
    try:
        first_db = DatabaseManager(f"sqlite:///{tmp_path / 'first.sqlite'}")
        first_controller = StrategyContinuousRunService()

        DatabaseManager.reset_instance()
        second_db = DatabaseManager(f"sqlite:///{tmp_path / 'second.sqlite'}")
        rebound_controller = StrategyContinuousRunService()

        assert rebound_controller is first_controller
        assert rebound_controller.db is second_db
        assert rebound_controller.db is not first_db
        with rebound_controller.db.get_session():
            pass
    finally:
        controller = StrategyContinuousRunService._instance
        if controller is not None:
            controller.stop_workers()
        StrategyContinuousRunService._instance = None
        DatabaseManager.reset_instance()
