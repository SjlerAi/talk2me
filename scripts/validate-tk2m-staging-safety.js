'use strict';

// Pure safety-contract test: stubs mysql2 so it never opens a database connection.
// Run with: node scripts/validate-tk2m-staging-safety.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/config/db.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

const stage = {
  CRM_STAGE_MODE: 'true',
  UAT_MODE: 'true',
  DB_HOST: 'localhost',
  DB_PORT: '3306',
  DB_NAME: 'talk_crm_stage',
  DB_USER: 'talk_crmstg',
  DB_PASSWORD: 'dummy-test-password',
  PRIVATE_UPLOAD_DIR: '/home/talk/crm-migration/staging-uploads/talk2me_uat_private_uploads',
  BASE_PATH: '/',
  APP_URL: 'https://crm.tk2m.co.za',
  SESSION_SECURE: 'true',
  OUTBOUND_EMAIL_ENABLED: 'false',
  ALLOW_MANAGEMENT_EXTERNAL_NOTIFICATIONS: 'false',
  CUDO_EXTERNAL_SEND_ENABLED: 'false',
  CRM_BACKGROUND_WORKERS_ENABLED: 'false'
};

function evaluate(changes = {}) {
  const env = { ...stage, ...changes };
  let constructed = 0;
  const context = {
    process: { env },
    module: { exports: null },
    require(name) {
      assert.equal(name, 'mysql2/promise');
      return {
        createPool(config) {
          constructed += 1;
          return config;
        }
      };
    }
  };
  vm.runInNewContext(source, context, { filename: 'src/config/db.js' });
  assert.equal(constructed, 1, 'Only one pool should be constructed');
  return context.module.exports;
}

function refuses(label, changes) {
  assert.throws(() => evaluate(changes), /safety:/i, label);
}

assert.equal(evaluate().database, 'talk_crm_stage');
assert.equal(evaluate().user, 'talk_crmstg');
refuses('Cannot point staging at live CRM', { DB_NAME: 'uent_Crm' });
refuses('Cannot use UENT credentials', { DB_USER: 'uent_Crm-Uat' });
refuses('Cannot use remote DB host', { DB_HOST: 'remote.example.test' });
refuses('Cannot use source upload root', { PRIVATE_UPLOAD_DIR: '/home/uent/talk2me_uat_private_uploads' });
refuses('Cannot enable outbound email', { OUTBOUND_EMAIL_ENABLED: 'true' });
refuses('Cannot enable management outbound', { ALLOW_MANAGEMENT_EXTERNAL_NOTIFICATIONS: 'true' });
refuses('Cannot enable Cudo outbound', { CUDO_EXTERNAL_SEND_ENABLED: 'true' });
refuses('Cannot enable background workers', { CRM_BACKGROUND_WORKERS_ENABLED: 'true' });
refuses('Cannot disable approved UAT screens', { UAT_MODE: 'false' });
refuses('Cannot use insecure cookies', { SESSION_SECURE: 'false' });
refuses('Cannot use source URL', { APP_URL: 'https://uent.co.za/talk2me' });
refuses('Cannot use source base path', { BASE_PATH: '/talk2me' });

const originalUat = {
  ...stage,
  CRM_STAGE_MODE: 'false',
  DB_NAME: 'uent_Crm',
  DB_USER: 'uent_Crm-Uat',
  PRIVATE_UPLOAD_DIR: '/home/uent/talk2me_uat_private_uploads',
  BASE_PATH: '/talk2me',
  APP_URL: 'https://uent.co.za/talk2me'
};
assert.equal(evaluate(originalUat).database, 'uent_Crm', 'Existing UAT contract must still work');
assert.match(server, /if \(!CRM_STAGE_MODE\) startAgentDeadlineScheduler\(\);/);
assert.match(server, /if \(!CRM_STAGE_MODE\) startNightlyLogoutWorker\(\);/);
assert.match(server, /CRM_STAGE_MODE \? '127\.0\.0\.1'/);
assert.match(server, /if \(!CRM_STAGE_MODE\) \{\s+const zippyIntegration = require/);
assert.match(server, /CRM_STAGE_MODE \? 'staging'/);

console.log('PASS: TK2M staging isolation, existing UAT safety, loopback binding, workers and Zippy boundary');
