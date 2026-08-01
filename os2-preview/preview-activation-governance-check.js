'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const preflight = fs.readFileSync(path.join(root, 'preview-activation-preflight.js'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'PREVIEW_ACTIVATION_RUNBOOK.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const requiredPreflightMarkers = [
  "expectedDatabase = 'kloka_talk2me'",
  "expectedBranch = 'agent/talk2me-os2-integrated-rebuild'",
  'expectedNodeMajor = 20',
  'ALLOW_PRODUCTION_MUTATION=true',
  'ENABLE_CUSTOMER_MERGE_EXECUTION=true',
  "'runtime-release-identity-check.js'",
  "'readiness-check.js'",
  "'deployment-check.js'",
  "'uat-gate-check.js'",
  "'release-manifest-check.js'",
  "stdio: 'inherit'",
  'result.error',
  'result.signal',
  'result.status !== 0',
  'databaseBackedVerificationExecuted: false',
  'migrationsExecuted: false',
  'previewRestartExecuted: false',
  'productionMutationEnabled: false',
  'mergeExecutionEnabled: false'
];
for (const marker of requiredPreflightMarkers) {
  if (!preflight.includes(marker)) throw new Error(`Preview activation preflight missing marker: ${marker}`);
}

const orderedScripts = [
  "'runtime-release-identity-check.js'",
  "'readiness-check.js'",
  "'deployment-check.js'",
  "'uat-gate-check.js'",
  "'release-manifest-check.js'"
];
for (let index = 1; index < orderedScripts.length; index += 1) {
  if (preflight.indexOf(orderedScripts[index - 1]) >= preflight.indexOf(orderedScripts[index])) {
    throw new Error('Preview activation preflight order is invalid');
  }
}

const requiredRunbookMarkers = [
  'talk2me.kloka.co.za',
  'talk2me.uent.co.za',
  'kloka_talk2me',
  'agent/talk2me-os2-integrated-rebuild',
  'Node.js: 20.x',
  'npm run verify:preview-activation-preflight',
  'npm ci',
  'npm run check',
  'ALLOW_PREVIEW_MIGRATIONS=true',
  'DB_NAME=kloka_talk2me npm run verify:preview-data',
  'Restart only the preview Node.js application',
  'Migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.'
];
for (const marker of requiredRunbookMarkers) {
  if (!runbook.includes(marker)) throw new Error(`Preview activation runbook missing marker: ${marker}`);
}

if (pkg.scripts['verify:preview-activation-preflight'] !== 'node preview-activation-preflight.js') {
  throw new Error('Missing verify:preview-activation-preflight command');
}
if (!pkg.scripts.check.includes('node --check preview-activation-preflight.js')) {
  throw new Error('Preview activation preflight syntax check missing from normal validation');
}

console.log(JSON.stringify({
  ok: true,
  check: 'preview-activation-governance',
  application: pkg.name,
  version: pkg.version,
  orderedSourceChecks: orderedScripts.length,
  productionMutationEnabled: false,
  mergeExecutionEnabled: false,
  databaseBackedVerificationExecuted: false,
  migrationsExecuted: false,
  previewRestartExecuted: false
}, null, 2));
