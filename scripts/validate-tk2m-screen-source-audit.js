'use strict';
// Read-only source audit: EJS compilation, referenced views and live assets.
// Does not connect to the database, modify a customer or call a live URL.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ejs=require('ejs');
const root=path.resolve(__dirname,'..');
const fromRoot=f=>fs.readFileSync(path.join(root,f),'utf8');
const viewDir=path.join(root,'views');
const views=fs.readdirSync(viewDir).filter(x=>x.endsWith('.ejs'));
let compiled=0,assetRefs=0;const missingAssets=[],missingTemplates=[];
for(const view of views){
 const file=path.join('views',view),source=fromRoot(file);
 ejs.compile(source,{filename:path.join(root,file)});
 compiled++;
 for(const m of source.matchAll(/<%=\s*basePath\s*%>\/public\/([A-Za-z0-9._/-]+)/g)){
  assetRefs++;const asset=path.join('public',m[1]);
  if(!fs.existsSync(path.join(root,asset)))missingAssets.push(file+' -> '+asset);
 }
}
const jsPaths=[];function walk(d){for(const e of fs.readdirSync(path.join(root,d),{withFileTypes:true})){
 const f=path.join(d,e.name);
 if(e.isDirectory())walk(f);else if(e.name.endsWith('.js'))jsPaths.push(f);
}}walk('src/routes');jsPaths.push('server.js');
let renderRefs=0;
for(const file of jsPaths){const source=fromRoot(file);
 for(const m of source.matchAll(/\bres\.render\(\s*['"]([A-Za-z0-9/_-]+)['"]/g)){
  renderRefs++;
  if(!fs.existsSync(path.join(viewDir,m[1]+'.ejs')))missingTemplates.push(file+' -> '+m[1]);
 }
}
assert.deepEqual(missingTemplates,[],'Every literal res.render template must exist');
assert.deepEqual(missingAssets,[],'Every static /public asset linked in a view must exist');
assert.ok(compiled>=90,'Do not silently lose existing CRM screen templates');
assert.ok(assetRefs>=90,'Template asset inventory unexpectedly shrank');
const index=fromRoot('src/routes/index.js');
const old=index.indexOf("router.get('/backoffice-old'");
const next=index.indexOf("router.get('/backoffice/inquiries/:id'",old);
assert.ok(old>=0&&next>old,'Retired Back Office URL must keep a route');
const legacy=index.slice(old,next);
assert.match(legacy,/res\.redirect\(302,/);
assert.match(legacy,/\/backoffice/);
assert.doesNotMatch(legacy,/res\.render\('backoffice'/);
console.log('TK2M_SCREEN_SOURCE_AUDIT_PASS views='+compiled+' asset_refs='+assetRefs+' render_refs='+renderRefs);
