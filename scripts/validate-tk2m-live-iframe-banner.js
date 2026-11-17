'use strict';
// Synthetic iframe checks: no real CRM records, credentials, or browser session.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../public/js/os-v6.js'),'utf8');
const start=src.indexOf('  function removeLegacyUatBannerFromFrame(frame) {');
const end=src.indexOf('  class WindowManager',start);
assert.ok(start>0 && end>start,'The popup must have a same-origin banner repair helper');
const helper=src.slice(start,end);

function handler(hostname='crm.tk2m.co.za'){
  const origin='https://'+hostname;
  return vm.runInNewContext(helper+'\nremoveLegacyUatBannerFromFrame;',{
    tk2mProductionHost:hostname==='crm.tk2m.co.za',
    location:{origin,hostname},
    URL
  });
}
function mockFrame({origin='https://crm.tk2m.co.za',legacyLink=true,pseudo='none'}={}){
 const added={};
 let removed=0;
 const location=origin+'/customers/123/360?panel=1';
 const links=legacyLink?[{href:origin+'/public/uat-safety.css?v=old',remove(){removed++}}]:[];
 const child={URL:location,baseURI:location,body:{},head:{appendChild(s){added[s.id]=s}},
   querySelectorAll(selector){assert.equal(selector,'link[rel~="stylesheet"]');return links},
   getElementById(id){return added[id]||null},
   createElement(tag){assert.equal(tag,'style');return {id:'',textContent:''}}
 };
 return {frame:{contentDocument:child,contentWindow:{
    getComputedStyle(_node,pseudoClass){assert.equal(pseudoClass,'::before');return {content:pseudo}}
 }},added,removedCount:()=>removed};
}
const old=mockFrame({legacyLink:true,pseudo:'"TALK2ME UAT / TEST — NOT LIVE"'});
assert.equal(handler()(old.frame),true);
assert.equal(old.removedCount(),1);
assert.match(old.added['tk2m-live-remove-stale-uat-banner'].textContent,/body::before\{content:none!important;display:none!important\}/);
assert.equal(handler()(old.frame),true,'older source link remains in synthetic fixture; override must be idempotent');
assert.equal(Object.keys(old.added).length,1,'must not duplicate override styles');
const stale=mockFrame({legacyLink:false,pseudo:'"TALK2ME UAT / TEST — NOT LIVE"'});
assert.equal(handler()(stale.frame),true);
assert.ok(stale.added['tk2m-live-remove-stale-uat-banner']);
const healthy=mockFrame({legacyLink:false,pseudo:'none'});
assert.equal(handler()(healthy.frame),false,'must not touch healthy live screens');
assert.equal(Object.keys(healthy.added).length,0);
const foreign=mockFrame({origin:'https://uent.co.za',legacyLink:true,pseudo:'"TALK2ME UAT / TEST — NOT LIVE"'});
assert.equal(handler()(foreign.frame),false,'do not touch cross-origin UENT frames');
assert.equal(foreign.removedCount(),0);
assert.equal(handler('uent.co.za')(mockFrame({legacyLink:true}).frame),false,'keep genuine test warning');
const render=src.slice(src.indexOf('    render(record) {'),src.indexOf('    install(record) {'));
assert.match(render,/frame\.addEventListener\('load',[\s\S]*?removeLegacyUatBannerFromFrame\(frame\)/);
assert.doesNotMatch(render,/frame\.addEventListener\('load',[\s\S]*?once: true/);
console.log('TK2M_LIVE_IFRAME_BANNER_REPAIR_PASS');