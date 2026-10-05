'use strict';
const fs=require('fs');
const assert=require('assert');

const route=fs.readFileSync('src/routes/uat-library.js','utf8');
const zip=fs.readFileSync('src/services/library-zip.js','utf8');
const ui=fs.readFileSync('public/js/uat-library.js','utf8');
const css=fs.readFileSync('public/css/uat-library.css','utf8');
const view=fs.readFileSync('views/uat-library.ejs','utf8');
const calendar=fs.readFileSync('public/js/calendar-home-uat.js','utf8');
const server=fs.readFileSync('server.js','utf8');

assert(server.includes("require('./src/routes/uat-library')"), 'UAT Library routes must be mounted');
assert(route.includes("path.join(privateRoot, 'library')"), 'Library files must live under private storage');
assert(route.includes("privateRoot === '/home/uent/talk2me_private_uploads'"), 'UAT Library must reject production private storage');
assert(!route.includes('LONGBLOB'), 'Library must not store file bodies in MySQL');
assert(route.includes('CREATE TABLE IF NOT EXISTS library_documents'), 'Library catalogue table must exist');
assert(route.includes('CREATE TABLE IF NOT EXISTS library_versions'), 'Library version history table must exist');
assert(route.includes('CREATE TABLE IF NOT EXISTS library_favourites'), 'Library favourites table must exist');
assert(route.includes('CREATE TABLE IF NOT EXISTS library_snapshots'), 'Library snapshot table must exist');
assert(route.includes("uploadOne = multer"), 'Library upload must use controlled private file upload');
assert(route.includes('40*1024*1024'), 'Library upload must enforce a file-size limit');
assert(route.includes(".array('files',10)"), 'Library batch upload must support up to 10 files');
assert(route.includes('/api/uat/library/documents/batch'), 'Library batch upload endpoint must exist');
assert(route.includes("access_level='all'"), 'Staff document access must be permission filtered');
assert(route.includes('/api/uat/library/documents/:id/version'), 'Managers must be able to publish a new version');
assert(route.includes('/api/uat/library/documents/:id/favourite'), 'Staff favourites must be supported');
assert(route.includes('/api/uat/library/documents/:id/preview'), 'Spreadsheet preview endpoint must exist');
assert(route.includes("document: 'ms-word'"), 'Word documents must have a native Office protocol');
assert(route.includes("spreadsheet: 'ms-excel'"), 'Excel documents must have a native Office protocol');
assert(route.includes("presentation: 'ms-powerpoint'"), 'PowerPoint documents must have a native Office protocol');
assert(route.includes('/api/uat/library/native/:token/:filename'), 'Native Office delivery endpoint must expose a real filename and extension');
assert(route.includes("createHmac('sha256'"), 'Native Office links must be signed');
assert(route.includes('const filename = encodeURIComponent(nativeFileName(row))'), 'Office native URL must end in the actual filename');
assert(route.includes('https://${req.get(\'host\')}'), 'Office native URL must use HTTPS');
assert(route.includes("String(req.params.filename||'')!==expectedName"), 'Native Office delivery must verify the filename in the direct URL');
assert(route.includes('15 * 60 * 1000'), 'Native Office links must be short lived');
assert(route.includes('/api/uat/library/export/current'), 'Full current Library export must exist');
assert(route.includes('/api/uat/library/snapshots'), 'Month-end snapshots must exist');
assert(route.includes('Library-Index.xlsx'), 'Exports must include an Excel index');
assert(route.includes('/api/uat/library/health'), 'Library health proof must exist');

assert(zip.includes('0x04034b50'), 'ZIP writer must emit local file headers');
assert(zip.includes('0x02014b50'), 'ZIP writer must emit central directory headers');
assert(zip.includes('0x06054b50'), 'ZIP writer must emit a ZIP end record');

assert(view.includes('Company favourites'), 'Library must expose company favourites');
assert(view.includes('My favourites'), 'Library must expose personal favourites');
assert(view.includes('Library Management'), 'Management UI must exist');
assert(view.includes('Create month-end snapshot'), 'Month-end snapshot control must exist');
assert(view.includes('Download original'), 'Original files must remain downloadable');
assert(view.includes('multiple accept='), 'Library upload control must allow choosing multiple files');
assert(view.includes('Choose up to 10 files'), 'Library upload UI must explain the 10-file batch limit');
assert(ui.includes("previewKind==='image'"), 'Image preview must exist');
assert(ui.includes("previewKind==='pdf'"), 'PDF preview must exist');
assert(ui.includes("previewKind==='spreadsheet'"), 'Spreadsheet preview must exist');
assert(ui.includes('doc?.nativeLaunch'), 'Office documents must launch their installed desktop app from the Library');
assert(ui.includes('/api/uat/library/documents/batch'), 'Library UI must use the batch upload endpoint');
assert(ui.includes('New version'), 'Admin version workflow must exist');
assert(css.includes('@media(max-width:760px)'), 'Library must have phone layout rules');
assert(css.includes('height:100dvh'), 'Library viewers must be mobile full-screen capable');

assert(calendar.includes('data-uat-library-launcher'), 'Library must be added to the top launcher');
assert(calendar.includes('/uat/library'), 'Library must be available in CRM navigation');

console.log('UAT Talk2Me Library V1 validation passed.');
