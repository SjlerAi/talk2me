'use strict';

const fs=require('fs');
const path=require('path');
function read(file){return fs.readFileSync(path.join(__dirname,file),'utf8');}
function requireText(source,needle,label){if(!source.includes(needle))throw new Error(`Missing ${label}`);}

const core=read('core/representatives.js');
const routes=read('representative-governance-routes.js');
const access=read('customer-access-routes.js');
const migration=read('migrations/20260801_023_representative_governance.sql');
const schema=read('schema-verification.js');
const packageJson=read('package.json');

requireText(core,'safeRepresentative','sanitised representative output');
requireText(core,'try { items = JSON.parse(trimmed); } catch','safe JSON parsing');
requireText(core,'REPRESENTATIVE_ACTIONS.has(item)','permission whitelist');
requireText(core,'os2_representative_history','representative lifecycle history');
requireText(routes,"router.put('/api/os2/representatives/:id'",'representative update route');
requireText(routes,"representatives:rows.map(safeRepresentative)",'sanitised list response');
requireText(routes,'REPRESENTATIVE_AND_REASON_REQUIRED','mandatory revocation reason');
requireText(access,'createRepresentativeGovernanceRouter','governance router mount');
requireText(migration,'os2_representative_history','history schema');
requireText(schema,"'os2_representative_history'",'history table schema verification');
requireText(schema,"'INVALID_REPRESENTATIVE_PERMISSIONS'",'permission JSON integrity verification');
requireText(schema,"'EXPIRED_ACTIVE_REPRESENTATIVES'",'expired representative integrity verification');
requireText(schema,'EXPECTED_MIGRATION_COUNT = 25','exact migration inventory expectation');
requireText(packageJson,'check:representative-governance','package script registration');

console.log(JSON.stringify({ok:true,check:'representative-governance',schemaMigration:23,exactMigrationInventory:25},null,2));
