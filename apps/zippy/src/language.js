'use strict';
// Language hints for reply voice and UI. Speech transcription is multilingual
// by default; these hints must never be used as an authentication or CRM rule.
const afWords=new Set('wat watter wie waar wanneer vandag more môre asseblief asb verjaar verjaarsdag verjaarsdae personeel kliënte kliente werk ingelog reeds klaar stuur herinner my moet het ons vir bel skakel afspraak taak take almal hierdie week volgende'.split(' '));
const enWords=new Set('what which who where when today tomorrow please birthday birthdays staff customers clients working logged done send remind me should have all this next week task tasks call phone appointment'.split(' '));
function detectLanguage(message,preferred='auto') {
 if(preferred==='af-ZA'||preferred==='en-ZA')return preferred;
 const words=String(message||'').normalize('NFKC').toLowerCase().match(/[\p{L}]+/gu)||[];
 let af=0,en=0;
 for(const word of words){if(afWords.has(word))af++;if(enWords.has(word))en++;}
 return af>en?'af-ZA':'en-ZA';
}
module.exports={detectLanguage};
