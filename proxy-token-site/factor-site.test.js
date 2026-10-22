const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { createFactorDataHandler } = require('./commerce/factor-site.cjs');

describe('versioned factor statistics', () => {
  let root, app;
  const first = 'a'.repeat(64), second = 'b'.repeat(64);
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'factor-site-'));
    for (const version of [first, second]) {
      const dir = path.join(root, 'versions', version); fs.mkdirSync(dir, { recursive:true });
      fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ meta:{ snapshot_id:version } }));
      fs.writeFileSync(path.join(dir, 's0.json'), JSON.stringify({ version }));
    }
    fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ version:first }));
    app = express(); app.use('/data', createFactorDataHandler(root)); app.use((_req,res) => res.status(404).send('legacy'));
  });
  afterEach(() => fs.rmSync(root, { recursive:true, force:true }));

  it('pins lazy shards even when current advances between index and detail requests', async () => {
    const index = await request(app).get('/data/index.json'); expect(index.body.meta.snapshot_id).toBe(first);
    fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ version:second }));
    expect((await request(app).get('/data/index.json')).body.meta.snapshot_id).toBe(second);
    const shard = await request(app).get('/data/s0.json?v=' + first);
    expect(shard.body.version).toBe(first);
    expect(shard.headers['cache-control']).toBe('private, no-store');
  });
  it('fails closed on invalid current, unknown versions and malformed version selectors', async () => {
    for (const query of ['../x', 'x', ['a', 'b']]) {
      const response = await request(app).get('/data/s0.json').query({v:query}); expect(response.statusCode).toBe(400);
    }
    expect((await request(app).get('/data/s0.json?v=' + 'c'.repeat(64))).statusCode).toBe(404);
    fs.writeFileSync(path.join(root, 'current.json'), '{');
    expect((await request(app).get('/data/index.json')).statusCode).toBe(503);
  });
  it('retains the prior serving path only before the managed pointer is installed', async () => {
    fs.unlinkSync(path.join(root, 'current.json'));
    expect((await request(app).get('/data/index.json')).text).toBe('legacy');
    expect((await request(app).get('/data/s0.json?v=' + first)).body.version).toBe(first);
  });
});
