const crypto = require('crypto');

const MAX_IMPORT_BYTES = 6 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function splitHeaderBody(input) {
  const match = input.match(/\r?\n\r?\n/);
  if (!match) return { headerText: input, bodyText: '' };
  const index = match.index;
  return {
    headerText: input.slice(0, index),
    bodyText: input.slice(index + match[0].length)
  };
}

function decodeQuotedPrintable(input) {
  const text = String(input || '').replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(Buffer.from(text[i], 'utf8')[0]);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodeMimeWord(value) {
  return String(value || '').replace(/=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g, (_m, _charset, encoding, data) => {
    try {
      if (encoding.toUpperCase() === 'B') return Buffer.from(data, 'base64').toString('utf8');
      return decodeQuotedPrintable(data.replace(/_/g, ' '));
    } catch {
      return data;
    }
  });
}

function parseHeaders(text) {
  const unfolded = String(text || '').replace(/\r?\n[ \t]+/g, ' ');
  const headers = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }
  return headers;
}

function parseHeaderValue(value) {
  const raw = String(value || '');
  const firstSemi = raw.indexOf(';');
  const main = (firstSemi === -1 ? raw : raw.slice(0, firstSemi)).trim().toLowerCase();
  const params = {};
  const rest = firstSemi === -1 ? '' : raw.slice(firstSemi + 1);
  const re = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^;]+))/g;
  let match;
  while ((match = re.exec(rest))) params[match[1].toLowerCase()] = decodeMimeWord((match[2] || match[3] || '').trim());
  return { main, params };
}

function decodeBody(body, transferEncoding) {
  const enc = String(transferEncoding || '').toLowerCase();
  if (enc === 'base64') {
    try { return Buffer.from(String(body || '').replace(/\s/g, ''), 'base64'); } catch { return Buffer.from(''); }
  }
  if (enc === 'quoted-printable') return Buffer.from(decodeQuotedPrintable(body), 'utf8');
  return Buffer.from(String(body || ''), 'utf8');
}

function splitMultipart(body, boundary) {
  const marker = `--${boundary}`;
  return String(body || '')
    .split(marker)
    .slice(1)
    .map(part => part.replace(/^\r?\n/, '').replace(/\r?\n--\s*$/, '').replace(/\r?\n$/, ''))
    .filter(Boolean);
}

function sanitiseHtml(input) {
  let html = String(input || '');
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  html = html.replace(/<(iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  html = html.replace(/<(iframe|object|embed|form)\b[^>]*\/?>/gi, '');
  html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
  html = html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
  html = html.replace(/<img\b[^>]*(?:width\s*=\s*["']?1["']?[^>]*height\s*=\s*["']?1["']?|height\s*=\s*["']?1["']?[^>]*width\s*=\s*["']?1["']?)[^>]*>/gi, '');
  return html;
}

function plainFromHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseEntity(raw, output) {
  const { headerText, bodyText } = splitHeaderBody(raw);
  const headers = parseHeaders(headerText);
  const type = parseHeaderValue(headers['content-type'] || 'text/plain');
  const disposition = parseHeaderValue(headers['content-disposition'] || '');
  const transfer = headers['content-transfer-encoding'] || '';

  if (type.main.startsWith('multipart/') && type.params.boundary) {
    for (const child of splitMultipart(bodyText, type.params.boundary)) parseEntity(child, output);
    return;
  }

  const decoded = decodeBody(bodyText, transfer);
  const filename = disposition.params.filename || type.params.name || '';
  const contentId = String(headers['content-id'] || '').replace(/[<>]/g, '').trim();
  const isAttachment = disposition.main === 'attachment' || Boolean(filename);

  if (isAttachment || (type.main.startsWith('image/') && contentId)) {
    if (decoded.length > MAX_ATTACHMENT_BYTES) return;
    output.totalAttachmentBytes += decoded.length;
    if (output.totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('Imported email attachments are too large. Keep the total attachments under 8 MB.');
    output.attachments.push({
      filename: filename || `inline-${crypto.randomBytes(4).toString('hex')}`,
      contentType: type.main || 'application/octet-stream',
      content: decoded.toString('base64'),
      cid: contentId || null,
      inline: Boolean(contentId)
    });
    return;
  }

  if (type.main === 'text/html' && !output.html) output.html = decoded.toString('utf8');
  if (type.main === 'text/plain' && !output.text) output.text = decoded.toString('utf8').trim();
}

function replaceCidImages(html, attachments) {
  let output = String(html || '');
  for (const item of attachments) {
    if (!item.cid || !item.contentType.startsWith('image/')) continue;
    const escaped = item.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`cid:${escaped}`, 'gi'), `data:${item.contentType};base64,${item.content}`);
  }
  return output;
}

function parseEml(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Choose an .eml file to import.');
  if (buffer.length > MAX_IMPORT_BYTES) throw new Error('The email file is too large. Maximum import size is 6 MB.');

  const raw = buffer.toString('utf8');
  const { headerText } = splitHeaderBody(raw);
  const headers = parseHeaders(headerText);
  const output = { html: '', text: '', attachments: [], totalAttachmentBytes: 0 };
  parseEntity(raw, output);

  let html = sanitiseHtml(replaceCidImages(output.html, output.attachments));
  const text = output.text || plainFromHtml(html);
  if (!html && text) html = `<div style="white-space:pre-wrap">${text.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</div>`;
  if (!html && !text) throw new Error('No readable email message was found in this .eml file.');

  return {
    subject: decodeMimeWord(headers.subject || '').trim(),
    originalFrom: decodeMimeWord(headers.from || '').trim(),
    html,
    text,
    attachments: output.attachments.filter(item => !item.inline),
    inlineImageCount: output.attachments.filter(item => item.inline).length
  };
}

function parseHtmlFile(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Choose an HTML file to import.');
  if (buffer.length > MAX_IMPORT_BYTES) throw new Error('The HTML file is too large. Maximum import size is 6 MB.');
  const html = sanitiseHtml(buffer.toString('utf8'));
  const text = plainFromHtml(html);
  if (!text && !html.trim()) throw new Error('The HTML file is empty.');
  return {
    subject: String(filename || '').replace(/\.(html?|htm)$/i, '').replace(/[_-]+/g, ' ').trim(),
    originalFrom: '',
    html,
    text,
    attachments: [],
    inlineImageCount: 0
  };
}

function parseImportedMessage(file) {
  const name = String(file?.originalname || '').toLowerCase();
  if (name.endsWith('.eml')) return parseEml(file.buffer);
  if (name.endsWith('.html') || name.endsWith('.htm')) return parseHtmlFile(file.buffer, file.originalname);
  throw new Error('Import an .eml, .html or .htm file. Outlook .msg files are not supported yet.');
}

function nodemailerAttachments(imported) {
  return (imported?.attachments || []).map(item => ({
    filename: item.filename,
    contentType: item.contentType,
    content: Buffer.from(item.content, 'base64')
  }));
}

module.exports = {
  MAX_IMPORT_BYTES,
  sanitiseHtml,
  plainFromHtml,
  parseImportedMessage,
  nodemailerAttachments
};
