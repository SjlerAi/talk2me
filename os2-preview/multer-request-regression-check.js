'use strict';

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function multipart(parts) {
  const boundary = `----os2-${crypto.randomBytes(12).toString('hex')}`;
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename !== undefined) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`));
      chunks.push(Buffer.from(`Content-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`));
      chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value || '')));
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${String(part.value || '')}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

function request(server, path, payload) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path,
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${payload.boundary}`,
        'content-length': payload.body.length
      },
      timeout: 5000
    }, res => {
      const chunks = [];
      let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 64 * 1024) {
          req.destroy(new Error('RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('REQUEST_TIMEOUT')));
    req.on('error', reject);
    req.end(payload.body);
  });
}

function route(upload) {
  return (req, res) => upload.single('file')(req, res, error => {
    if (error) return res.status(400).json({ ok: false, code: error.code || 'UPLOAD_REJECTED' });
    return res.status(200).json({
      ok: true,
      file: req.file ? {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      } : null,
      fields: Object.keys(req.body || {}).sort()
    });
  });
}

async function main() {
  const app = express();
  const bounded = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 32, files: 1, fields: 2, parts: 3 },
    fileFilter: (req, file, callback) => {
      if (file.mimetype !== 'text/plain') {
        const error = new Error('UNSUPPORTED_UPLOAD_TYPE');
        error.code = 'UNSUPPORTED_UPLOAD_TYPE';
        return callback(error);
      }
      return callback(null, true);
    }
  });
  app.post('/upload', route(bounded));

  const server = http.createServer(app);
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const valid = await request(server, '/upload', multipart([
      { name: 'type', value: 'sample' },
      { name: 'file', filename: 'sample.txt', contentType: 'text/plain', value: 'hello' }
    ]));
    assert(valid.status === 200 && valid.body.ok === true, 'valid single file must pass');
    assert(valid.body.file && valid.body.file.size === 5, 'valid file metadata missing');

    const missing = await request(server, '/upload', multipart([{ name: 'type', value: 'sample' }]));
    assert(missing.status === 200 && missing.body.file === null, 'missing file must remain visible to route validation');

    const duplicate = await request(server, '/upload', multipart([
      { name: 'file', filename: 'one.txt', contentType: 'text/plain', value: 'one' },
      { name: 'file', filename: 'two.txt', contentType: 'text/plain', value: 'two' }
    ]));
    const duplicateCodes = new Set(['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE']);
    assert(duplicate.status === 400 && duplicateCodes.has(duplicate.body.code), 'multiple files must fail closed');

    const oversized = await request(server, '/upload', multipart([
      { name: 'file', filename: 'large.txt', contentType: 'text/plain', value: Buffer.alloc(33, 65) }
    ]));
    assert(oversized.status === 400 && oversized.body.code === 'LIMIT_FILE_SIZE', 'oversized file must fail closed');

    const excessiveFields = await request(server, '/upload', multipart([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
      { name: 'c', value: '3' }
    ]));
    assert(excessiveFields.status === 400 && excessiveFields.body.code === 'LIMIT_FIELD_COUNT', 'field overflow must fail closed');

    const excessiveParts = await request(server, '/upload', multipart([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
      { name: 'file', filename: 'one.txt', contentType: 'text/plain', value: 'one' },
      { name: 'extra', value: '4' }
    ]));
    assert(excessiveParts.status === 400 && excessiveParts.body.code === 'LIMIT_PART_COUNT', 'part overflow must fail closed');

    const unsupported = await request(server, '/upload', multipart([
      { name: 'file', filename: 'sample.bin', contentType: 'application/octet-stream', value: 'data' }
    ]));
    assert(unsupported.status === 400 && unsupported.body.code === 'UNSUPPORTED_UPLOAD_TYPE', 'unsupported MIME must fail closed');

    const serialized = JSON.stringify({
      ok: true,
      check: 'multer-request-regression',
      isolatedLoopbackOnly: true,
      databaseConfigured: false,
      persistentStorageUsed: false,
      cases: {
        validSingleFile: true,
        missingFileVisibleToRoute: true,
        multipleFilesRejected: true,
        oversizedFileRejected: true,
        excessiveFieldsRejected: true,
        excessivePartsRejected: true,
        unsupportedMimeRejected: true
      },
      productionMutationEnabled: false
    });
    assert(!serialized.includes('/home/') && !serialized.includes('node_modules'), 'evidence must not expose private paths');
    console.log(serialized);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error && error.message ? error.message : 'MULTER_REQUEST_REGRESSION_FAILED');
  process.exit(1);
});
