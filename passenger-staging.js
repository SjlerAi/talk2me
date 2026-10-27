'use strict';

// This is a staging-only Passenger entry point. It must never be used as the
// eventual production startup file. No database or mail credentials belong in Git.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '1';

const runtime = String(process.env.CRM_RUNTIME_ENV_FILE || '').trim();
const protectedParent = '/home/talk/crm-migration';
if (!runtime || path.dirname(path.resolve(runtime)) !== protectedParent ||
    !path.basename(runtime).endsWith('.env')) {
  throw new Error('TK2M staging requires a designated private runtime configuration file.');
}
const attributes = fs.statSync(runtime);
if (!attributes.isFile() || (attributes.mode & 0o077) !== 0) {
  throw new Error('TK2M staging runtime configuration is not a private file.');
}
const loaded = dotenv.config({path: runtime, override: false});
if (loaded.error) throw loaded.error;
if (String(process.env.CRM_STAGE_MODE || '') !== 'true') {
  throw new Error('Refusing to start the staging Passenger app without staging mode.');
}
if (String(process.env.UAT_MODE || '') !== 'true') {
  throw new Error('Refusing to start without the approved UAT feature set.');
}
require('./server');
