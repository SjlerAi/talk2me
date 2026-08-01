'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const evidenceDir = path.join(root, 'build-evidence');
const packageJson = require('./package.json');

function walk(directory, prefix = '') {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (['node_modules', 'build-evidence', '.git'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.join(prefix, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) files.push(...walk(absolute, relative));
    else files.push({ absolute, relative });
  }
  return files;
}

function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });

  const files = walk(root)
    .filter(item => /\.(js|json|sql|md)$/.test(item.relative))
    .sort((a, b) => a.relative.localeCompare(b.relative));

  const manifest = files.map(item => ({
    path: item.relative,
    bytes: fs.statSync(item.absolute).size,
    sha256: checksum(item.absolute)
  }));

  const evidence = {
    application: 'Talk2Me OS2 integrated rebuild',
    version: packageJson.version,
    generatedAt: new Date().toISOString(),
    commitSha: process.env.GITHUB_SHA || null,
    branch: process.env.GITHUB_REF_NAME || null,
    workflowRunId: process.env.GITHUB_RUN_ID || null,
    workflowRunNumber: process.env.GITHUB_RUN_NUMBER || null,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    fileCount: manifest.length,
    migrationCount: manifest.filter(item => item.path.startsWith('migrations/') && item.path.endsWith('.sql')).length,
    routeFileCount: manifest.filter(item => item.path.endsWith('-routes.js')).length,
    checkFileCount: manifest.filter(item => item.path.endsWith('-check.js')).length,
    manifest
  };

  const jsonPath = path.join(evidenceDir, 'build-evidence.json');
  fs.writeFileSync(jsonPath, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  const digest = checksum(jsonPath);
  fs.writeFileSync(path.join(evidenceDir, 'build-evidence.sha256'), `${digest}  build-evidence.json\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, version: evidence.version, files: evidence.fileCount, migrations: evidence.migrationCount, sha256: digest }, null, 2));
}

main();
