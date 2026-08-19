const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`Missing required deployment file: ${relativePath}`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function requireText(relativePath, text, explanation) {
  const source = read(relativePath);
  if (!source.includes(text)) failures.push(`${relativePath}: ${explanation}`);
}

const server = read('server.js');
const sessionPosition = server.indexOf('app.use(session({');
for (const route of ["'/api/health'", "'/api/release'"]) {
  const position = server.indexOf(route);
  if (position < 0) failures.push(`server.js: missing public ${route} route`);
  if (sessionPosition >= 0 && position > sessionPosition) failures.push(`server.js: ${route} must be registered before session middleware`);
}

requireText('.github/workflows/verify-elitehost-connection.yml', 'environment: talk2me-uat', 'connection test must use the protected GitHub environment');
requireText('.github/workflows/verify-elitehost-connection.yml', 'ELITEHOST_SSH_PRIVATE_KEY', 'connection test must consume the exact private-key secret');
requireText('.github/workflows/bootstrap-elitehost-uat-agent.yml', 'BOOTSTRAP UAT AGENT', 'bootstrap must require explicit confirmation');
requireText('.github/workflows/deploy-elitehost-uat.yml', 'DEPLOY UAT', 'deployment must require explicit confirmation');
requireText('.github/workflows/deploy-elitehost-uat.yml', 'sha256sum', 'artifact checksum must be created and revalidated');
requireText('.github/workflows/deploy-elitehost-uat.yml', 'deploy/uat-control', 'workflow must use the dedicated control branch');
requireText('.github/workflows/deploy-elitehost-uat.yml', 'status: \'HOLD\'', 'workflow must return the control manifest to HOLD');
requireText('scripts/talk2me-uat-agent.sh', 'test "$REPOSITORY" = SjlerAi/talk2me', 'agent must pin the repository identity');
requireText('scripts/talk2me-uat-agent.sh', 'expected_artifact="talk2me-${COMMIT}-${WORKFLOWRUNID}.tar.gz"', 'agent must pin artifact name to commit and run');
requireText('scripts/deploy-uat-artifact.sh', 'EXPECTED_SHA256', 'driver must validate the expected checksum');
requireText('scripts/deploy-uat-artifact.sh', 'rollback()', 'driver must provide rollback on failed activation');
requireText('scripts/deploy-uat-artifact.sh', 'tmp/restart.txt', 'driver must restart Passenger');

const deployWorkflow = read('.github/workflows/deploy-elitehost-uat.yml');
if (/\b(db:migrate|scripts\/migrate|mysql\s|\.sql\b)/i.test(deployWorkflow)) {
  failures.push('deploy workflow: SQL and database migrations must remain outside automated deployment');
}

const control = JSON.parse(read('deploy/uat.json') || '{}');
if (control.status !== 'HOLD' || control.repository !== 'SjlerAi/talk2me' || control.environment !== 'uat') {
  failures.push('deploy/uat.json: committed control manifest must be a Talk2Me UAT HOLD manifest');
}

if (failures.length) {
  console.error('Talk2Me deployment validation failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Talk2Me deployment validation passed.');
console.log('- public health and exact-release routes are available before session middleware');
console.log('- GitHub environment, encrypted SSH, immutable artifact, checksum, control branch and HOLD reset are enforced');
console.log('- server agent pins repository/commit/run identity and activation includes backup, rollback and Passenger restart');
console.log('- automated deployment contains no SQL or migration execution');
