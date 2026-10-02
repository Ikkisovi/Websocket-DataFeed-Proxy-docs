// Isolated preview: no portal account store, registry, SMTP, or background jobs.
const express = require('express');
const path = require('path');
const { createChartHistoryHandler } = require('../shared/chart-proxy.cjs');
const app = express();
app.use(express.static(path.join(__dirname, '../public')));
app.get('/api/chart/bars', createChartHistoryHandler());
app.get('/api/account/token', (_req, res) => res.set('Cache-Control', 'no-store').status(401).json({ code: 'preview_requires_token' }));
const port = Number(process.env.PORT || 18785);
const hosts = [...new Set(['127.0.0.1', process.env.CHART_PREVIEW_HOST].filter(Boolean))];
for (const host of hosts) {
  app.listen(port, host, () => console.log(`Chart preview: http://${host}:${port}/chart/`));
}
