# Backtest Summary (backtest_grid)

## Best

- Rank By: `max_drawdown_pct`
- Fee/Slippage: `0.0` / `0.0` bps
- Funding(bps/cycle): `0.0`
- Final Cash: `100089.032626`
- Return(%): `0.089033`
- Max Drawdown(%): `0.114935`

## Top Results

| Rank | Fee(bps) | Slippage(bps) | Funding(bps/cycle) | Final Cash | Return(%) | MaxDD(%) | Sharpe |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.0 | 0.0 | 0.0 | 100089.032626 | 0.089033 | 0.114935 | 0.555217 |
| 2 | 0.0 | 1.0 | 0.0 | 100084.606652 | 0.084607 | 0.117333 | 0.530244 |
| 3 | 1.0 | 0.0 | 0.0 | 100084.606652 | 0.084607 | 0.117935 | 0.528917 |
| 4 | 0.0 | 2.0 | 0.0 | 100080.180678 | 0.080181 | 0.119731 | 0.504974 |
| 5 | 1.0 | 1.0 | 0.0 | 100080.180679 | 0.080181 | 0.120333 | 0.50373 |

## Notes

- best final_cash spread versus worst is 30.981808
- drawdown cap for conservative candidate is 1.0%
- average return stays non-negative up to fee=5.0 bps
- average return stays non-negative up to slippage=2.0 bps
