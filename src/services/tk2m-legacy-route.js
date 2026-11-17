'use strict';
// Root-domain compatibility for a pre-cutover /talk2me link on TK2M LIVE.
// Never redirect writes, credentials, or arbitrary external origins.
const PREFIX='/talk2me';
function legacyRootPath(value){
  if(typeof value!=='string'||!/^\/talk2me(?=\/|\?|$)/i.test(value))return null;
  const rest=value.slice(PREFIX.length);
  if(rest&&!rest.startsWith('/')&&!rest.startsWith('?'))return null;
  const destination=rest.startsWith('?')?'/'+rest:(rest||'/');
  if(!destination.startsWith('/')||destination.startsWith('//')||
     /[\\\r\n\x00]/.test(destination)||/%(?:0a|0d|5c)/i.test(destination))return null;
  try{
    const resolved=new URL(destination,'https://crm.tk2m.co.za');
    if(resolved.origin!=='https://crm.tk2m.co.za')return null;
    return destination;
  }catch(_){return null}
}
module.exports={legacyRootPath};
