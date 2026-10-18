"""Project reviewed local study aggregates into public editorial data.

Use the validated OpenAlice artifact Python environment. Source pins remain in
private research receipts; no security-level records or internal metadata ship.
"""
import argparse
import csv
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--study', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
fit = json.loads((a.study / 'simple-reconstruction.json').read_text())
legacy = json.loads((a.study / 'archive-audit.json').read_text())
data = {
    'review_date': '2026-10-17',
    'reconstruction': {
        'feature_count': len(fit['features']), 'fundamental_count': len(fit['fundamental_features']),
        'common_rows': fit['common_rows'], 'common_securities': fit['common_securities'],
        'feature_lag_sessions': fit['feature_lag_observed_sessions'], 'splits': fit['splits'],
        'models': [{'id': k, 'stages': {stage: {key: value[key] for key in [
            'mean_daily_spearman', 'top50_mean_overlap', 'dates', 'rows', 'securities']}
            for stage, value in v.items()}} for k, v in fit['models'].items()],
    },
    'archived_diagnostic': {
        'start': legacy['start'], 'end': legacy['end'],
        'rank_horizon_days': 5, 'top_n': legacy['configuration']['top_n'],
        'one_way_cost_bps': legacy['configuration']['cost_bps'],
        'rebalance_intervals': legacy['rebalance_events'] - 1,
        'five_session_intervals': legacy['five_session_intervals'],
        'session_gap_counts': legacy['rebalance_gaps_in_observed_price_sessions'],
        'annual_returns': legacy['annual_returns'],
        'brain': {k: legacy['brain'][k] for k in ['cagr', 'annualized_volatility', 'arithmetic_sharpe_zero_rf', 'max_drawdown']},
        'spy': {k: legacy['spy'][k] for k in ['cagr', 'annualized_volatility', 'arithmetic_sharpe_zero_rf', 'max_drawdown']},
    },
}
a.output.mkdir(parents=True, exist_ok=True)
(a.output / 'analysis.json').write_text(json.dumps(data, indent=2, allow_nan=False)+'\n')
with (a.output / 'annual-diagnostic.csv').open('w') as f:
    writer = csv.DictWriter(f, fieldnames=['year', 'brain', 'spy', 'difference', 'partial_year'])
    writer.writeheader(); writer.writerows(data['archived_diagnostic']['annual_returns'])
with (a.output / 'reconstruction.csv').open('w') as f:
    writer = csv.writer(f); writer.writerow(['model', 'stage', 'mean_daily_spearman', 'top50_mean_overlap', 'dates', 'rows', 'securities'])
    for model in data['reconstruction']['models']:
        for stage, value in model['stages'].items(): writer.writerow([model['id'], stage, *value.values()])
print('Public report aggregates written; source identities, source digests and row-level predictions excluded')
