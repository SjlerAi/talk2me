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

function request(server, path, payload, options = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const body = Buffer.isBuffer(payload.body) ? payload.body : Buffer.from(payload.body || '');
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path,
      method: 'POST',
      headers: {
        'content-type': options.contentType || `multipart/form-data; boundary=${payload.boundary}`,
        'content-length': body.length
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
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, text, body: JSON.parse(text || '{}') });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('REQUEST_TIMEOUT')));
    req.on('error', reject);
    req.end(body);
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

function assertControlledError(response, label) {
  assert(response.status === 400, `${label} must return 400`);
  assert(response.body && response.body.ok === false, `${label} must return controlled JSON`);
  assert(typeof response.body.code === 'string' && response.body.code.length <= 64, `${label} must return bounded code`);
  assert(!/\/home\/|node_modules|Error:|at\s+\w+|\\/.test(response.text), `${label} must not expose paths or stacks`);
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
    assert(valid.body.file.originalname === 'sample.txt', 'valid original filename missing');
    assert(valid.body.file.mimetype === 'text/plain', 'valid MIME metadata missing');

    const missing = await request(server, '/upload', multipart([{ name: 'type', value: 'sample' }]));
    assert(missing.status === 200 && missing.body.file === null, 'missing file must remain visible to route validation');

    const empty = await request(server, '/upload', multipart([]));
    assert(empty.status === 200 && empty.body.file === null, 'empty multipart request must remain visible to route validation');

    const duplicate = await request(server, '/upload', multipart([
      { name: 'file', filename: 'one.txt', contentType: 'text/plain', value: 'one' },
      { name: 'file', filename: 'two.txt', contentType: 'text/plain', value: 'two' }
    ]));
    const duplicateCodes = new Set(['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE']);
    assertControlledError(duplicate, 'multiple files');
    assert(duplicateCodes.has(duplicate.body.code), 'multiple files must use reviewed rejection code');

    const wrongField = await request(server, '/upload', multipart([
      { name: 'attachment', filename: 'one.txt', contentType: 'text/plain', value: 'one' }
    ]));
    assertControlledError(wrongField, 'wrong file field');
    assert(wrongField.body.code === 'LIMIT_UNEXPECTED_FILE', 'wrong file field must fail closed');

    const oversized = await request(server, '/upload', multipart([
      { name: 'file', filename: 'large.txt', contentType: 'text/plain', value: Buffer.alloc(32, 65) }
    ]));
    assertControlledError(oversized, 'file at strict size limit');
    assert(oversized.body.code === 'LIMIT_FILE_SIZE', 'file at strict size limit must fail closed');

    const belowLimit = await request(server, '/upload', multipart([
      { name: 'file', filename: 'below.txt', contentType: 'text/plain', value: Buffer.alloc(31, 65) }
    ]));
    assert(belowLimit.status === 200 && belowLimit.body.file.size === 31, 'file below size limit must pass');

    const excessiveFields = await request(server, '/upload', multipart([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
      { name: 'c', value: '3' }
    ]));
    assertControlledError(excessiveFields, 'field overflow');
    assert(excessiveFields.body.code === 'LIMIT_FIELD_COUNT', 'field overflow must fail closed');

    const duplicateFields = await request(server, '/upload', multipart([
      { name: 'type', value: 'one' },
      { name: 'type', value: 'two' }
    ]));
    assert(duplicateFields.status === 200, 'duplicate fields within count limit must remain visible to route validation');
    assert(duplicateFields.body.fields.includes('type'), 'duplicate field name must remain visible');

    const excessiveParts = await request(server, '/upload', multipart([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
      { name: 'file', filename: 'one.txt', contentType: 'text/plain', value: 'one' },
      { name: 'extra', value: '4' }
    ]));
    assertControlledError(excessiveParts, 'part overflow');
    assert(excessiveParts.body.code === 'LIMIT_PART_COUNT', 'part overflow must fail closed');

    const unsupported = await request(server, '/upload', multipart([
      { name: 'file', filename: 'sample.bin', contentType: 'application/octet-stream', value: 'data' }
    ]));
    assertControlledError(unsupported, 'unsupported MIME');
    assert(unsupported.body.code === 'UNSUPPORTED_UPLOAD_TYPE', 'unsupported MIME must fail closed');

    const malformed = multipart([
      { name: 'file', filename: 'sample.txt', contentType: 'text/plain', value: 'hello' }
    ]);
    const wrongBoundary = await request(server, '/upload', malformed, {
      contentType: 'multipart/form-data; boundary=----different-boundary'
    });
    assertControlledError(wrongBoundary, 'wrong boundary');
    assert(wrongBoundary.body.code === 'UPLOAD_REJECTED', 'wrong boundary must fail closed');

    const truncatedBoundary = `----os2-${crypto.randomBytes(12).toString('hex')}`;
    const truncatedBody = Buffer.from(
      `--${truncatedBoundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="sample.txt"\r\n' +
      'Content-Type: text/plain\r\n\r\n' +
      'hel'
    );
    const truncated = await request(server, '/upload', {
      boundary: truncatedBoundary,
      body: truncatedBody
    });
    assertControlledError(truncated, 'truncated body');
    assert(truncated.body.code === 'UPLOAD_REJECTED', 'truncated body must fail closed');

    const missingBoundary = await request(server, '/upload', { body: Buffer.from('invalid') }, {
      contentType: 'multipart/form-data'
    });
    assertControlledError(missingBoundary, 'missing boundary');
    assert(missingBoundary.body.code === 'UPLOAD_REJECTED', 'missing boundary must fail closed');

    const serialized = JSON.stringify({
      ok: true,
      check: 'multer-request-regression',
      isolatedLoopbackOnly: true,
      externalNetworkUsed: false,
      databaseConfigured: false,
      persistentStorageUsed: false,
      responseBytesBounded: true,
      requestTimeoutBounded: true,
      controlledErrorsRequired: true,
      privatePathDisclosureDetected: false,
      stackDisclosureDetected: false,
      cases: {
        validSingleFile: true,
        belowFileSizeLimitAccepted: true,
        strictFileSizeLimitRejected: true,
        missingFileVisibleToRoute: true,
        emptyMultipartVisibleToRoute: true,
        multipleFilesRejected: true,
        wrongFieldRejected: true,
        excessiveFieldsRejected: true,
        duplicateFieldsVisibleToRoute: true,
        excessivePartsRejected: true,
        unsupportedMimeRejected: true,
        wrongBoundaryRejected: true,
        truncatedBodyRejected: true,
        missingBoundaryRejected: true
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
