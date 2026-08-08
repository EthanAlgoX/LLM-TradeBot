import assert from "node:assert/strict";
import test from "node:test";
import {
  deflatedSharpeFromEquity,
  deflatedSharpeFromReturns,
  expectedMaxSharpe,
} from "../packages/runtime/src/deflated-sharpe.js";
import { ExperimentConstraintsSchema } from "../packages/contracts/src/index.js";

// Reference values computed with the numguard reference implementation
// (Bailey & López de Prado 2014; same fixture returns, exact expected-max
// formula, Acklam probit). Tolerance covers the erfc approximation (<1.2e-7).
const RETURNS = [
  0.01, -0.005, 0.02, 0.003, -0.01, 0.007, 0.015, -0.002, 0.004, 0.006,
  -0.008, 0.012, 0.001, -0.003, 0.009, 0.011, -0.006, 0.002, 0.008, -0.001,
];
const TOL = 1e-6;

test("per-period Sharpe matches reference", () => {
  const v = deflatedSharpeFromReturns(RETURNS, 1);
  assert.ok(v);
  assert.ok(Math.abs(v.sharpe - 0.46684697308023854) < TOL);
  assert.ok(Math.abs(v.skew - 0.11356875986754761) < TOL);
  assert.ok(Math.abs(v.kurt - 2.2708234767522097) < TOL);
});

test("single trial: no deflation, DSR equals PSR", () => {
  const v = deflatedSharpeFromReturns(RETURNS, 1);
  assert.ok(v);
  assert.equal(v.deflationBar, 0);
  assert.ok(Math.abs(v.dsr - 0.978237155456722) < TOL);
  assert.ok(Math.abs(v.dsr - v.psr) < TOL);
});

test("deflation bar rises with trial count and DSR falls", () => {
  const v5 = deflatedSharpeFromReturns(RETURNS, 5);
  const v50 = deflatedSharpeFromReturns(RETURNS, 50);
  assert.ok(v5 && v50);
  assert.ok(Math.abs(v5.deflationBar - 0.2735998280815124) < TOL);
  assert.ok(Math.abs(v5.dsr - 0.798308301616701) < TOL);
  assert.ok(Math.abs(v50.deflationBar - 0.5222197447964245) < TOL);
  assert.ok(Math.abs(v50.dsr - 0.4053861113140287) < TOL);
  assert.ok(v50.dsr < v5.dsr);
  assert.ok(v5.dsr < v5.psr);
});

test("expected max Sharpe matches reference", () => {
  assert.ok(Math.abs(expectedMaxSharpe(50, 0.1) - 0.2276303093889215) < TOL);
  assert.ok(Math.abs(expectedMaxSharpe(5, 0.2) - 0.2385188003154829) < TOL);
  assert.equal(expectedMaxSharpe(1, 0.1), 0);
});

test("equity series converts to returns and skips non-positive equity", () => {
  const equity = [100];
  for (const r of RETURNS) equity.push(equity[equity.length - 1] * (1 + r));
  const fromEquity = deflatedSharpeFromEquity(equity, 5);
  const fromReturns = deflatedSharpeFromReturns(RETURNS, 5);
  assert.ok(fromEquity && fromReturns);
  assert.ok(Math.abs(fromEquity.dsr - fromReturns.dsr) < TOL);
  // a zero-equity point must not produce an infinite return
  const withGap = [100, 0, 101, 102, 103, 104];
  const v = deflatedSharpeFromEquity(withGap, 2);
  assert.ok(v);
  assert.equal(v.observationCount, 3);
});

test("insufficient or degenerate series returns null", () => {
  assert.equal(deflatedSharpeFromReturns([0.01, 0.02], 5), null);
  assert.equal(deflatedSharpeFromReturns([0.01, 0.01, 0.01], 5), null);
  assert.equal(deflatedSharpeFromEquity([100, 100, 100, 100], 5), null);
});

test("constraints schema accepts and bounds deflatedSharpeGte", () => {
  assert.ok(
    ExperimentConstraintsSchema.safeParse({ deflatedSharpeGte: 0.95 }).success,
  );
  assert.ok(
    !ExperimentConstraintsSchema.safeParse({ deflatedSharpeGte: 1.5 }).success,
  );
  assert.ok(
    !ExperimentConstraintsSchema.safeParse({ deflatedSharpeGte: -0.1 }).success,
  );
});
