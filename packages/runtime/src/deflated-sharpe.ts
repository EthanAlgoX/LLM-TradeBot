// Deflated Sharpe Ratio (Bailey & López de Prado, 2014).
//
// An experiment compares N participant versions and the approval gate scores
// each backtest in isolation. Under pure noise the best of N backtests still
// looks good, so a gate without a deflation bar approves the luckiest draft.
// The DSR restates a Sharpe as P(true SR > expected max SR of N zero-skill
// trials), adjusting for sample length and non-normal returns.
//
// Pure math, no dependencies. Parity-tested against the numguard reference
// implementation (tests-ts/deflated-sharpe.test.ts).

const EULER = 0.5772156649015329;

/** Complementary error function (Numerical Recipes 6.2.2, |error| < 1.2e-7). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t *
                                  (1.48851587 +
                                    t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? ans : 2 - ans;
}

function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

/** Inverse standard-normal CDF (Acklam), ~1e-9. */
function probit(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error("DEFLATED_SHARPE_PROBIT_DOMAIN");
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const plow = 0.02425;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= 1 - plow) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/** Expected Sharpe of the luckiest of `trialCount` zero-skill trials whose SR
 *  estimates have standard deviation `srStd`. */
export function expectedMaxSharpe(trialCount: number, srStd: number): number {
  if (trialCount < 1) throw new Error("DEFLATED_SHARPE_TRIALS_INVALID");
  if (trialCount === 1) return 0;
  const z1 = probit(1 - 1 / trialCount);
  const z2 = probit(1 - 1 / (trialCount * Math.E));
  return srStd * ((1 - EULER) * z1 + EULER * z2);
}

export interface DeflatedSharpeResult {
  /** Observed per-period Sharpe (not annualised). */
  sharpe: number;
  /** Expected max Sharpe of `trialCount` zero-skill trials — the bar. */
  deflationBar: number;
  /** P(true SR > deflation bar): the deflated Sharpe ratio. */
  dsr: number;
  /** P(true SR > 0), no deflation. */
  psr: number;
  skew: number;
  kurt: number;
  observationCount: number;
  trialCount: number;
}

/** DSR of a return series that was selected as one of `trialCount` variants.
 *  Returns null when the series cannot support the statistic (fewer than
 *  three returns, or zero variance) — callers should surface UNAVAILABLE. */
export function deflatedSharpeFromReturns(
  returns: readonly number[],
  trialCount: number,
): DeflatedSharpeResult | null {
  const n = returns.length;
  if (n < 3 || trialCount < 1) return null;
  const mu = returns.reduce((s, r) => s + r, 0) / n;
  const m2 = returns.reduce((s, r) => s + (r - mu) ** 2, 0) / n;
  const sd = Math.sqrt(m2);
  // `sd === 0` is exact and a constant series does not reach it: its standard
  // deviation is floating-point residue rather than a true zero (6.5e-19 for a flat
  // 0.1% series), so the Sharpe divides out to ~1e15 and this returned a dsr of 1 --
  // certainty of a real edge, from the one input that carries no information about
  // one. The residue grows with the number of terms summed, so the floor scales with
  // n: measured at most 1.96 eps x scale over constant series spanning values
  // 1e-7..1e3 and lengths 3..10000, while a real series with sigma=1e-12 sits more
  // than ten orders of magnitude above n eps x scale.
  const magnitude = returns.reduce((s, r) => Math.max(s, Math.abs(r)), 0);
  if (!(sd > n * Number.EPSILON * magnitude)) return null;
  const m3 = returns.reduce((s, r) => s + (r - mu) ** 3, 0) / n;
  const m4 = returns.reduce((s, r) => s + (r - mu) ** 4, 0) / n;
  const skew = m3 / sd ** 3;
  const kurt = m4 / sd ** 4; // non-excess: normal = 3
  const sr = mu / sd;
  const srStd = 1 / Math.sqrt(n - 1); // SR sampling std under the null
  const bar = expectedMaxSharpe(trialCount, srStd);
  const psrDenom = Math.max(1 - skew * sr + ((kurt - 1) / 4) * sr ** 2, 1e-18);
  const scale = Math.sqrt(n - 1) / Math.sqrt(psrDenom);
  return {
    sharpe: sr,
    deflationBar: bar,
    dsr: normCdf((sr - bar) * scale),
    psr: normCdf(sr * scale),
    skew,
    kurt,
    observationCount: n,
    trialCount,
  };
}

/** Convenience: DSR from an equity series (converted to simple returns).
 *  Non-positive equity points are sentinels for non-trading cycles (see
 *  projectArtifactEvidence), so transitions into or out of them are skipped
 *  rather than read as ±100% returns. */
export function deflatedSharpeFromEquity(
  equity: readonly number[],
  trialCount: number,
): DeflatedSharpeResult | null {
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i += 1) {
    const prev = equity[i - 1];
    const next = equity[i];
    if (!Number.isFinite(prev) || !Number.isFinite(next)) continue;
    if (prev <= 0 || next <= 0) continue;
    returns.push(next / prev - 1);
  }
  return deflatedSharpeFromReturns(returns, trialCount);
}
