'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Index and lazy-loaded shards stay on one immutable version during a daily switch.
function createFactorDataHandler(root) {
  return (req, res, next) => {
    const requested = req.query.v;
    let version = requested;
    if (requested !== undefined && (typeof requested !== 'string' || !/^[a-f0-9]{64}$/.test(requested))) {
      return res.status(400).json({ error: 'invalid_statistics_version' });
    }
    if (!version) {
      try {
        version = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8')).version;
        if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version)) throw new Error('invalid current version');
      } catch (error) {
        if (error.code === 'ENOENT') return next();
        return res.status(503).json({ error: 'statistics_temporarily_unavailable' });
      }
    }
    if (!/^\/(index|s[0-7])\.json$/.test(req.path)) return res.sendStatus(404);
    const folder = path.join(root, 'versions', version);
    try {
      if (fs.lstatSync(folder).isSymbolicLink()) throw new Error('invalid version folder');
      const file = path.join(folder, req.path.slice(1));
      if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new Error('invalid data file');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Factor-Statistics-Version', version);
      return res.sendFile(file, error => {
        if (error && !res.headersSent) res.sendStatus(503);
      });
    } catch {
      return res.status(requested ? 404 : 503).json({ error: 'statistics_temporarily_unavailable' });
    }
  };
}

module.exports = { createFactorDataHandler };
