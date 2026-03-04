# Backtest Summary (backtest_grid)

## Best

- Rank By: `max_drawdown_pct`
- Fee/Slippage: `0.0` / `0.0` bps
- Final Cash: `100013.936207`
- Return(%): `0.013936`
- Max Drawdown(%): `0.294983`

## Top Results

| Rank | Fee(bps) | Slippage(bps) | Final Cash | Return(%) | MaxDD(%) | Sharpe |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.0 | 0.0 | 100013.936207 | 0.013936 | 0.294983 | 0.052904 |
| 2 | 0.0 | 1.0 | 100005.909189 | 0.005909 | 0.29937 | 0.023209 |
| 3 | 1.0 | 0.0 | 100005.909189 | 0.005909 | 0.299573 | 0.023219 |
| 4 | 0.0 | 2.0 | 99997.882171 | -0.002118 | 0.303757 | -0.006481 |
| 5 | 1.0 | 1.0 | 99997.882171 | -0.002118 | 0.30396 | -0.006486 |

## Notes

- best final_cash spread versus worst is 56.189127
- drawdown cap for conservative candidate is 1.0%
- average return stays non-negative up to fee=0.0 bps
- all slippage buckets show negative average return
