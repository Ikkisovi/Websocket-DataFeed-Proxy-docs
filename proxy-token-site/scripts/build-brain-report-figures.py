"""Render standalone figures from the public, aggregate-only report data."""
import argparse
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

p = argparse.ArgumentParser(); p.add_argument('--data', type=Path, required=True); a = p.parse_args()
d = json.loads(a.data.read_text()); out = a.data.parent
plt.rcParams.update({'font.family':'DejaVu Sans', 'font.size':10, 'axes.spines.top':False,
    'axes.spines.right':False, 'axes.spines.left':False, 'axes.edgecolor':'#d5dfcf',
    'figure.facecolor':'#fbfcf9', 'axes.facecolor':'#fbfcf9', 'text.color':'#25372c',
    'axes.labelcolor':'#5f7058', 'xtick.color':'#687960', 'ytick.color':'#687960',
    'svg.fonttype':'none', 'svg.hashsalt':'brain-review-20261017', 'savefig.facecolor':'#fbfcf9'})
labels = ['Fundamentals / linear','Momentum + volatility / linear','Combined / linear','Combined / boosted trees']
values = [x['stages']['later']['mean_daily_spearman'] for x in d['reconstruction']['models']]
fig, ax = plt.subplots(figsize=(9,4.6)); fig.subplots_adjust(left=.32,right=.94,top=.77,bottom=.22)
ax.barh(labels[::-1],values[::-1],color=['#486455','#6c875d','#91a281','#b3bea5']);ax.set_xlim(0,1)
ax.set_xlabel('Mean daily Spearman correlation with the Brain ranking');ax.set_axisbelow(True);ax.grid(axis='x',alpha=.16)
for i,v in enumerate(values[::-1]):ax.text(v+.015,i,f'{v:.3f}',va='center',color='#25372c')
fig.text(.035,.92,'How much of the ranking can ordinary features recover?',fontsize=15,fontweight='medium')
fig.text(.035,.85,'15 features | identical complete cases | later period: July 2024 - September 2026',fontsize=10,color='#687960')
fig.text(.035,.07,'Reconstruction of ranks, not returns. Local feature overlap only. Later dates were previously inspected.',fontsize=9,color='#687960')
for ext in ['png','svg']:fig.savefig(out/('reconstruction.'+ext),dpi=180,metadata={'Date':None} if ext=='svg' else None)
plt.close(fig)
rows=d['archived_diagnostic']['annual_returns'];x=[r['year']for r in rows];y=[100*r['difference']for r in rows]
fig,ax=plt.subplots(figsize=(10,4.8));fig.subplots_adjust(left=.09,right=.97,top=.77,bottom=.24)
ax.bar(x,y,color=['#486455'if v>=0 else '#b78b70'for v in y],width=.68);ax.axhline(0,color='#a3b39a',linewidth=.8);ax.grid(axis='y',alpha=.14);ax.set_axisbelow(True);ax.set_ylabel('Brain minus SPY / percentage points');ax.set_xticks(x);ax.set_xticklabels([str(v)[2:] for v in x]);ax.set_ylim(-14,24)
fig.text(.035,.92,'The same archived curve tells different stories across years',fontsize=15,fontweight='medium')
fig.text(.035,.85,'Archived diagnostic only | January 2010 - September 2026 | not a validated fixed-five-session backtest',fontsize=10,color='#687960')
fig.text(.035,.075,'2010 and 2026 are partial years. Missing prices and execution clocks have not been independently admitted.',fontsize=9,color='#687960')
for ext in ['png','svg']:fig.savefig(out/('annual-diagnostic.'+ext),dpi=180,metadata={'Date':None} if ext=='svg' else None)
plt.close(fig)
print('Standalone PNG and editable SVG figures rendered from public report aggregates')

for name in ['reconstruction.svg', 'annual-diagnostic.svg']:
    path = out / name
    path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines()) + '\n')
