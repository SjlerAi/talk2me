'use strict';
// Captured once per Node/Passenger worker boot. Unlike the release metadata
// file, this identity cannot change until the actual worker is replaced.
const fs = require('node:fs');
const path = require('node:path');
let workerBootCommit = null;
try {
  const release = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../.talk2me-release.json'), 'utf8'));
  const commit = String(release.commit || '').trim().toLowerCase();
  if (/^[a-f0-9]{40}$/.test(commit)) workerBootCommit = commit;
} catch (_) {
  // CI and development checkouts may have no release metadata.
}
module.exports = Object.freeze({
  workerBootCommit,
  workerBootTime: new Date().toISOString()
});
