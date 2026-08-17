from __future__ import annotations

import os
import tempfile
import unittest
from datetime import date, timedelta

import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1.endpoints.simulation import router as simulation_router
from src.services.strategy_definition_service import StrategyDefinitionService
from src.services.strategy_validation_service import StrategyValidationError, StrategyValidationService
from src.storage import (
    DatabaseManager,
    SimulationStrategyValidationBarRecord,
    SimulationStrategyVersionRecord,
    StockDaily,
)


class StrategyValidationServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.path = tempfile.mktemp(suffix=".sqlite")
        DatabaseManager.reset_instance()
        self.db = DatabaseManager(f"sqlite:///{self.path}")
        self.definitions = StrategyDefinitionService(self.db)
        self.validation = StrategyValidationService(self.db, refresh_missing_data=False)
        created = self.definitions.create_strategy({"name": "历史验证策略"})
        self.version_id = created["draft"]["id"]
        self._seed_bars()
        with self.db.session_scope() as session:
            version = session.get(SimulationStrategyVersionRecord, self.version_id)
            version.market_scope_json = '{"universeMode":"fixed","symbols":["600001","000002"]}'

    def tearDown(self) -> None:
        DatabaseManager.reset_instance()
        if os.path.exists(self.path):
            os.unlink(self.path)

    def _seed_bars(self) -> None:
        first = date(2024, 1, 1)
        with self.db.session_scope() as session:
            for offset in range(120):
                current = first + timedelta(days=offset)
                for code, base, slope in (("600001", 10.0, 0.04), ("000002", 18.0, 0.025)):
                    close = base + slope * offset
                    session.add(StockDaily(
                        code=code,
                        date=current,
                        open=close - 0.02,
                        high=close + 0.08,
                        low=close - 0.08,
                        close=close,
                        volume=1_000_000 + offset * 1_000,
                        amount=close * (1_000_000 + offset * 1_000),
                        data_source="validation-test",
                    ))

    def _payload(self, *, key: str = "validation-test-key", symbols: list[str] | None = None) -> dict:
        return {
            "strategyVersionId": self.version_id,
            "idempotencyKey": key,
            "config": {
                "startDate": "2024-01-25",
                "endDate": "2024-04-20",
                "initialCapital": 1_000_000,
                "commissionRate": 0.0003,
                "slippageRate": 0.001,
                "executionRule": "next_open",
                "rebalanceFrequency": "weekly",
                "market": "cn",
                "maxPositions": 2,
                "maxUniverseSize": 10,
                "universeMode": "strategy" if symbols is None else "override",
                "experimentPurpose": "validation" if symbols is None else "diagnostic",
                "symbols": [] if symbols is None else symbols,
            },
        }

    def _second_version(self, *, screening_strategy: str = "oversold_reversal") -> int:
        with self.db.session_scope() as session:
            source = session.get(SimulationStrategyVersionRecord, self.version_id)
            source.status = "PUBLISHED"
            source.immutable = True
            source.version_number = 1
            target = SimulationStrategyVersionRecord(
                strategy_id=source.strategy_id,
                version=2,
                config_json=source.config_json,
                status="PUBLISHED",
                version_number=2,
                objective=source.objective,
                strategy_purpose=source.strategy_purpose,
                market_scope_json=source.market_scope_json,
                time_horizon=source.time_horizon,
                decision_policy_json=source.decision_policy_json,
                risk_policy_json=source.risk_policy_json,
                memory_policy_json=source.memory_policy_json,
                data_permission_snapshot_json=source.data_permission_snapshot_json,
                screening_policy_json=(
                    '{"strategy":"' + screening_strategy + '","market":"cn","maxCandidates":2}'
                ),
                immutable=True,
                revision=1,
            )
            session.add(target)
            session.flush()
            return target.id

    def _completed_for_version(
        self,
        version_id: int,
        *,
        key: str,
        initial_capital: int = 1_000_000,
    ) -> dict:
        payload = self._payload(key=key)
        payload["strategyVersionId"] = version_id
        payload["config"]["initialCapital"] = initial_capital
        created = self.validation.create_experiment(payload)
        return self.validation.execute_experiment(created["id"])

    def test_experiment_freezes_inputs_and_replays_without_future_execution(self) -> None:
        created = self.validation.create_experiment(self._payload())
        self.assertEqual(created["status"], "queued")
        self.assertGreater(created["barCount"], 100)

        # Source changes after creation must not change the frozen experiment.
        with self.db.session_scope() as session:
            session.query(StockDaily).update({StockDaily.close: 999.0})

        completed = self.validation.execute_experiment(created["id"])
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(completed["result"]["marketSnapshot"]["barCount"], created["barCount"])
        self.assertEqual(completed["result"]["methodology"], "historical_ohlcv_policy_replay")
        self.assertGreater(len(completed["result"]["equityCurve"]), 2)
        self.assertGreater(len(completed["result"]["trades"]), 0)
        self.assertEqual(completed["result"]["equityCurve"][0]["positionCount"], 0)
        first_buy_date = next(item["executionDate"] for item in completed["result"]["trades"] if item["side"] == "buy")
        first_rebalance_buys = [
            item for item in completed["result"]["trades"]
            if item["side"] == "buy" and item["executionDate"] == first_buy_date
        ]
        self.assertEqual({item["code"] for item in first_rebalance_buys}, {"600001", "000002"})
        for trade in completed["result"]["trades"]:
            self.assertLess(trade["signalDate"], trade["executionDate"])

        with self.db.get_session() as session:
            frozen_close = session.query(SimulationStrategyValidationBarRecord.close).filter_by(
                experiment_id=created["id"], code="600001"
            ).first()[0]
        self.assertNotEqual(frozen_close, 999.0)
        self.assertEqual(completed["integrityStatus"], "verified")
        self.assertTrue(completed["result"]["dataQuality"]["complete"])
        self.assertEqual(completed["result"]["strategyCoverage"]["level"], "partial")
        self.assertEqual(self.validation.version_status(self.version_id)["status"], "completed")

    def test_validation_uses_the_kline_provider_frozen_in_strategy_version(self) -> None:
        with self.db.session_scope() as session:
            version = session.get(SimulationStrategyVersionRecord, self.version_id)
            version.data_permission_snapshot_json = '{"schemaVersion":2,"kline":{"enabled":true,"connection":"kline:akshare","timeframe":"1d"}}'
            session.query(StockDaily).update({StockDaily.data_source: "AkshareFetcher"})

        created = self.validation.create_experiment(self._payload(key="provider-frozen-key"))
        completed = self.validation.execute_experiment(created["id"])
        self.assertEqual(completed["result"]["marketSnapshot"]["sources"], ["AkshareFetcher"])

        with self.db.session_scope() as session:
            session.query(StockDaily).update({StockDaily.data_source: "YfinanceFetcher"})
        with self.assertRaises(StrategyValidationError) as wrong_source:
            self.validation.create_experiment(self._payload(key="provider-mismatch-key"))
        self.assertEqual(wrong_source.exception.code, "VALIDATION_UNIVERSE_EMPTY")

    def test_idempotency_and_invalid_history_are_explicit(self) -> None:
        payload = self._payload()
        first = self.validation.create_experiment(payload)
        again = self.validation.create_experiment(payload)
        self.assertEqual(first["id"], again["id"])
        changed = self._payload()
        changed["config"]["initialCapital"] = 2_000_000
        with self.assertRaises(StrategyValidationError) as conflict:
            self.validation.create_experiment(changed)
        self.assertEqual(conflict.exception.code, "IDEMPOTENCY_CONFLICT")

        with self.assertRaises(StrategyValidationError) as missing:
            self.validation.create_experiment(self._payload(key="missing-bars-key", symbols=["688888"]))
        self.assertEqual(missing.exception.code, "VALIDATION_UNIVERSE_EMPTY")

    def test_definition_change_invalidates_result_but_publish_metadata_does_not(self) -> None:
        with self.assertRaises(StrategyValidationError) as required:
            self.validation.require_completed_for_publish(self.version_id, None)
        self.assertEqual(required.exception.code, "PUBLISH_HISTORICAL_VALIDATION_REQUIRED")
        created = self.validation.create_experiment(self._payload())
        self.validation.execute_experiment(created["id"])
        self.assertEqual(self.validation.require_completed_for_publish(self.version_id, created["id"])["id"], created["id"])
        with self.db.session_scope() as session:
            version = session.get(SimulationStrategyVersionRecord, self.version_id)
            version.status = "PUBLISHED"
            version.immutable = True
            version.version_number = 1
            version.revision += 1
        self.assertEqual(self.validation.version_status(self.version_id)["status"], "completed")

        with self.db.session_scope() as session:
            version = session.get(SimulationStrategyVersionRecord, self.version_id)
            version.objective = "定义已经改变"
            version.revision += 1
        self.assertEqual(self.validation.version_status(self.version_id)["status"], "not_started")
        with self.assertRaises(StrategyValidationError) as stale:
            self.validation.require_completed_for_publish(self.version_id, created["id"])
        self.assertEqual(stale.exception.code, "PUBLISH_HISTORICAL_VALIDATION_STALE")

    def test_http_contract_creates_executes_lists_and_reads_status(self) -> None:
        app = FastAPI()
        app.include_router(simulation_router, prefix="/api/v1/simulation")
        client = TestClient(app)

        create_response = client.post(
            "/api/v1/simulation/definition/validation-experiments",
            json=self._payload(key="api-validation-key"),
        )
        self.assertEqual(create_response.status_code, 200, create_response.text)
        experiment_id = create_response.json()["id"]
        execute_response = client.post(
            f"/api/v1/simulation/definition/validation-experiments/{experiment_id}/execute"
        )
        self.assertEqual(execute_response.status_code, 200, execute_response.text)
        self.assertEqual(execute_response.json()["status"], "completed")

        list_response = client.get(
            "/api/v1/simulation/definition/validation-experiments",
            params={"strategyVersionId": self.version_id},
        )
        self.assertEqual(list_response.status_code, 200, list_response.text)
        self.assertEqual(list_response.json()["items"][0]["id"], experiment_id)
        status_response = client.get(
            f"/api/v1/simulation/definition/strategy-versions/{self.version_id}/validation-status"
        )
        self.assertEqual(status_response.status_code, 200, status_response.text)
        self.assertEqual(status_response.json()["status"], "completed")

    def test_version_comparison_uses_only_real_completed_experiment_results(self) -> None:
        baseline = self._completed_for_version(self.version_id, key="comparison-base-key")
        target_version_id = self._second_version()
        target = self._completed_for_version(target_version_id, key="comparison-target-key")

        candidates = self.validation.list_comparison_candidates(
            baseline["strategyId"]
        )
        self.assertEqual({item["id"] for item in candidates}, {baseline["id"], target["id"]})

        comparison = self.validation.compare_experiments({
            "baselineExperimentId": baseline["id"],
            "targetExperimentId": target["id"],
        })
        self.assertEqual(comparison["baseline"]["strategyVersionId"], self.version_id)
        self.assertEqual(comparison["target"]["strategyVersionId"], target_version_id)
        self.assertEqual(comparison["comparisonBasis"]["snapshotMode"], "exact_snapshot")
        self.assertTrue(comparison["comparisonBasis"]["sameUniverse"])
        cumulative = next(item for item in comparison["metrics"] if item["key"] == "cumulativeReturn")
        self.assertEqual(cumulative["baselineValue"], baseline["result"]["metrics"]["cumulativeReturn"])
        self.assertEqual(cumulative["targetValue"], target["result"]["metrics"]["cumulativeReturn"])
        self.assertAlmostEqual(cumulative["delta"], cumulative["targetValue"] - cumulative["baselineValue"])

    def test_version_comparison_rejects_mismatched_assumptions_and_diagnostics(self) -> None:
        baseline = self._completed_for_version(self.version_id, key="comparison-mismatch-base")
        target_version_id = self._second_version()
        target = self._completed_for_version(
            target_version_id,
            key="comparison-mismatch-target",
            initial_capital=2_000_000,
        )
        with self.assertRaises(StrategyValidationError) as mismatch:
            self.validation.compare_experiments({
                "baselineExperimentId": baseline["id"],
                "targetExperimentId": target["id"],
            })
        self.assertEqual(mismatch.exception.code, "VALIDATION_COMPARISON_ASSUMPTIONS_MISMATCH")
        self.assertIn("初始资金", mismatch.exception.message)

        diagnostic = self.validation.execute_experiment(
            self.validation.create_experiment(
                self._payload(key="comparison-diagnostic", symbols=["600001"])
            )["id"]
        )
        with self.assertRaises(StrategyValidationError) as unsupported:
            self.validation.compare_experiments({
                "baselineExperimentId": baseline["id"],
                "targetExperimentId": diagnostic["id"],
            })
        self.assertEqual(unsupported.exception.code, "VALIDATION_COMPARISON_DIAGNOSTIC_UNSUPPORTED")

    def test_http_contract_lists_candidates_and_compares_versions(self) -> None:
        baseline = self._completed_for_version(self.version_id, key="comparison-api-base")
        target_version_id = self._second_version()
        target = self._completed_for_version(target_version_id, key="comparison-api-target")
        app = FastAPI()
        app.include_router(simulation_router, prefix="/api/v1/simulation")
        client = TestClient(app)

        candidates_response = client.get(
            "/api/v1/simulation/definition/validation-comparison-candidates",
            params={"strategyId": baseline["strategyId"]},
        )
        self.assertEqual(candidates_response.status_code, 200, candidates_response.text)
        self.assertEqual(len(candidates_response.json()["items"]), 2)
        comparison_response = client.post(
            "/api/v1/simulation/definition/validation-comparisons",
            json={"baselineExperimentId": baseline["id"], "targetExperimentId": target["id"]},
        )
        self.assertEqual(comparison_response.status_code, 200, comparison_response.text)
        self.assertEqual(comparison_response.json()["strategyId"], baseline["strategyId"])
        self.assertEqual(comparison_response.json()["target"]["strategyVersionId"], target_version_id)

    def test_strategy_universe_is_default_and_requires_point_in_time_membership(self) -> None:
        with self.db.session_scope() as session:
            version = session.get(SimulationStrategyVersionRecord, self.version_id)
            version.market_scope_json = '{}'
        no_symbols = self._payload(key="no-symbols-key")
        with self.assertRaises(StrategyValidationError) as missing_symbols:
            self.validation.create_experiment(no_symbols)
        self.assertEqual(missing_symbols.exception.code, "VALIDATION_POINT_IN_TIME_UNIVERSE_UNAVAILABLE")
        self.assertIn("生存者偏差", missing_symbols.exception.message)

    def test_strategy_fixed_universe_runs_without_experiment_symbols(self) -> None:
        with self.db.session_scope() as session:
            version = session.get(SimulationStrategyVersionRecord, self.version_id)
            version.market_scope_json = '{"universeMode":"fixed","symbols":["600001","000002"]}'
        payload = self._payload(key="strategy-fixed-universe-key")
        payload["config"]["symbols"] = []
        payload["config"]["universeMode"] = "strategy"
        payload["config"]["experimentPurpose"] = "validation"
        created = self.validation.create_experiment(payload)
        self.assertEqual(created["config"]["symbols"], ["600001", "000002"])
        self.assertEqual(created["config"]["resolvedUniverseMode"], "strategy_fixed")
        completed = self.validation.execute_experiment(created["id"])
        self.assertEqual(completed["result"]["strategyReplay"]["universeMode"], "strategy_fixed")

    def test_override_mode_requires_symbols_only_after_explicit_opt_in(self) -> None:
        payload = self._payload(key="empty-override-key")
        payload["config"]["symbols"] = []
        payload["config"]["universeMode"] = "override"
        payload["config"]["experimentPurpose"] = "diagnostic"
        with self.assertRaises(StrategyValidationError) as missing_symbols:
            self.validation.create_experiment(payload)
        self.assertEqual(missing_symbols.exception.code, "VALIDATION_OVERRIDE_SYMBOLS_REQUIRED")

    def test_diagnostic_experiment_never_changes_validation_status_or_qualifies_for_publish(self) -> None:
        created = self.validation.create_experiment(self._payload(key="diagnostic-governance-key", symbols=["600001"]))
        completed = self.validation.execute_experiment(created["id"])
        self.assertEqual(completed["config"]["experimentPurpose"], "diagnostic")
        self.assertEqual(self.validation.version_status(self.version_id)["status"], "not_started")
        with self.assertRaises(StrategyValidationError) as rejected:
            self.validation.require_completed_for_publish(self.version_id, completed["id"])
        self.assertEqual(rejected.exception.code, "PUBLISH_DIAGNOSTIC_EXPERIMENT_NOT_ELIGIBLE")

    def test_formal_validation_rejects_an_experiment_stock_override(self) -> None:
        payload = self._payload(key="formal-override-key", symbols=["600001"])
        payload["config"]["experimentPurpose"] = "validation"
        with self.assertRaises(StrategyValidationError) as rejected:
            self.validation.create_experiment(payload)
        self.assertEqual(rejected.exception.code, "VALIDATION_STRATEGY_UNIVERSE_REQUIRED")

    def test_rejects_incomplete_requested_range(self) -> None:

        with self.db.session_scope() as session:
            session.query(StockDaily).filter(StockDaily.date < date(2024, 3, 1)).delete()
        with self.assertRaises(StrategyValidationError) as incomplete:
            self.validation.create_experiment(self._payload(key="partial-range-key"))
        self.assertEqual(incomplete.exception.code, "VALIDATION_HISTORY_COVERAGE_INCOMPLETE")
        self.assertIn("实验未创建", incomplete.exception.message)

    def test_applies_strategy_position_limit_and_cn_cost_schedule(self) -> None:
        with self.db.session_scope() as session:
            version = session.get(SimulationStrategyVersionRecord, self.version_id)
            version.risk_policy_json = '{"max_position_pct":20}'
        created = self.validation.create_experiment(self._payload(key="risk-cost-key"))
        completed = self.validation.execute_experiment(created["id"])
        buys = [item for item in completed["result"]["trades"] if item["side"] == "buy"]
        sells = [item for item in completed["result"]["trades"] if item["side"] == "sell"]
        self.assertTrue(buys)
        self.assertTrue(sells)
        self.assertTrue(all(item["grossAmount"] + item["totalFees"] <= item["positionLimitAmount"] + 0.01 for item in buys))
        self.assertTrue(all(item["commission"] >= 5 for item in buys))
        self.assertTrue(all(item["stampDuty"] > 0 for item in sells))
        self.assertTrue(all(item["transferFee"] > 0 for item in buys + sells))
        self.assertEqual(completed["result"]["strategyReplay"]["maxPositionPercent"], 20.0)

    def test_detects_tampering_of_frozen_market_snapshot(self) -> None:
        created = self.validation.create_experiment(self._payload(key="tamper-key"))
        with self.db.session_scope() as session:
            row = session.query(SimulationStrategyValidationBarRecord).filter_by(experiment_id=created["id"]).first()
            row.open += 1
        with self.assertRaises(StrategyValidationError) as tampered:
            self.validation.execute_experiment(created["id"])
        self.assertEqual(tampered.exception.code, "VALIDATION_SNAPSHOT_INTEGRITY_FAILED")
        detail = self.validation.get_experiment(created["id"])
        self.assertEqual(detail["status"], "failed")
        self.assertEqual(detail["integrityStatus"], "failed")

    def test_refreshes_missing_explicit_symbol_through_real_data_provider_contract(self) -> None:
        class FakeMarketDataFetcher:
            def __init__(self) -> None:
                self.calls: list[tuple[str, str, str]] = []

            def get_daily_data(self, symbol: str, *, start_date: str, end_date: str):
                self.calls.append((symbol, start_date, end_date))
                first = date(2024, 1, 1)
                rows = []
                for offset in range(120):
                    current = first + timedelta(days=offset)
                    close = 12 + offset * 0.02
                    rows.append({"date": current, "open": close - 0.01, "high": close + 0.05, "low": close - 0.05, "close": close, "volume": 2_000_000, "amount": close * 2_000_000})
                return pd.DataFrame(rows), "ProviderContractTest"

        fetcher = FakeMarketDataFetcher()
        service = StrategyValidationService(self.db, market_data_fetcher=fetcher)
        created = service.create_experiment(self._payload(key="refresh-key", symbols=["601999"]))
        self.assertEqual(created["status"], "queued")
        self.assertEqual(fetcher.calls[0][0], "601999")
        self.assertEqual(fetcher.calls[0][1:], ("2023-09-27", "2024-04-20"))
        with self.db.get_session() as session:
            sources = {row[0] for row in session.query(StockDaily.data_source).filter_by(code="601999").all()}
        self.assertEqual(sources, {"ProviderContractTest"})


if __name__ == "__main__":
    unittest.main()
