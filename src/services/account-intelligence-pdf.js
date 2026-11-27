'use strict';
const MAX_PAGES=40;
const MAX_TEXT=4000000;
async function extractPdfText(input) {
  if (!Buffer.isBuffer(input) || input.length<8 || input.length>12*1024*1024 ||
      input.subarray(0,5).toString('latin1')!=='%PDF-') throw new Error('The file is not a supported PDF');
  // Dynamic ESM load keeps module import side-effect-free in normal CRM startup.
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf=await pdfjs.getDocument({
    data:new Uint8Array(input),isEvalSupported:false,disableFontFace:true,
    useSystemFonts:true,stopAtErrors:true
  }).promise;
  if (pdf.numPages<1 || pdf.numPages>MAX_PAGES) {
    await pdf.destroy();
    throw new Error('PDF exceeds the supported page limit');
  }
  let text='';
  try {
    for (let index=1;index<=pdf.numPages;index++) {
      const page=await pdf.getPage(index);
      const content=await page.getTextContent();
      const items=content.items.filter(x=>typeof x.str==='string' && Array.isArray(x.transform))
        .map(x=>({s:x.str,x:x.transform[4],y:x.transform[5]}))
        .filter(x=>x.s.trim());
      items.sort((a,b)=>Math.abs(a.y-b.y)>2?b.y-a.y:a.x-b.x);
      let currentY=null,row='';
      for(const item of items) {
        if(currentY!==null && Math.abs(item.y-currentY)>2) {
          text+=row.trimEnd()+'\n';row='';
        }
        // Separate PDF text runs so the billing columns do not merge.
        row+= (row?' ':'')+item.s;
        currentY=item.y;
      }
      text+=row.trimEnd()+'\n';
      if(text.length>MAX_TEXT)throw new Error('PDF text exceeds processing limit');
    }
  } finally { await pdf.destroy(); }
  return text;
}
module.exports={extractPdfText};
