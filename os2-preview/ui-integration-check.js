'use strict';
const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..','public','os2');
const required=['index.html','integrated-workspace.css','integrated-workspace.js'];
const failures=[];
for(const file of required){if(!fs.existsSync(path.join(root,file)))failures.push(`Missing ${file}`);}
if(!failures.length){const html=fs.readFileSync(path.join(root,'index.html'),'utf8');const js=fs.readFileSync(path.join(root,'integrated-workspace.js'),'utf8');const css=fs.readFileSync(path.join(root,'integrated-workspace.css'),'utf8');
for(const token of ['integrated-workspace.css','integrated-workspace.js','data-view="customers"'])if(!html.includes(token))failures.push(`index.html missing ${token}`);
for(const token of ['/api/os2/customers/search','/api/os2/customers/${id}/360','/api/os2/work-items','/api/os2/approvals'])if(!js.includes(token))failures.push(`workspace JS missing ${token}`);
for(const token of ['integrated-shell','integrated-panel','@media'])if(!css.includes(token))failures.push(`workspace CSS missing ${token}`);
if((html.match(/integrated-workspace\.js/g)||[]).length!==1)failures.push('workspace JS must be mounted exactly once');}
if(failures.length){console.error(failures.join('\n'));process.exit(1);}console.log('Integrated workspace UI check passed.');