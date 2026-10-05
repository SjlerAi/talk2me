'use strict';

const fs = require('fs');
const path = require('path');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(input) {
  const d = input instanceof Date && !Number.isNaN(input.getTime()) ? input : new Date();
  const year = Math.max(1980, d.getFullYear());
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { date, time };
}

function safeZipPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/^\.+$/, '_').trim() || '_')
    .filter(Boolean)
    .join('/')
    .replace(/^\/+/, '');
}

function uniqueName(name, used) {
  let candidate = safeZipPath(name) || 'file';
  if (!used.has(candidate.toLowerCase())) {
    used.add(candidate.toLowerCase());
    return candidate;
  }
  const ext = path.extname(candidate);
  const base = ext ? candidate.slice(0, -ext.length) : candidate;
  let i = 2;
  while (used.has(`${base} (${i})${ext}`.toLowerCase())) i += 1;
  candidate = `${base} (${i})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function localHeader(nameBuffer, crc, size, stamp) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  header.writeUInt32LE(crc >>> 0, 14);
  header.writeUInt32LE(size >>> 0, 18);
  header.writeUInt32LE(size >>> 0, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader(nameBuffer, crc, size, stamp, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(stamp.time, 12);
  header.writeUInt16LE(stamp.date, 14);
  header.writeUInt32LE(crc >>> 0, 16);
  header.writeUInt32LE(size >>> 0, 20);
  header.writeUInt32LE(size >>> 0, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset >>> 0, 42);
  return header;
}

function endRecord(count, centralSize, centralOffset) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralSize >>> 0, 12);
  end.writeUInt32LE(centralOffset >>> 0, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

function writeZip(entries, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(outputPath, 'w', 0o600);
  let offset = 0;
  const central = [];
  const used = new Set();

  try {
    for (const entry of entries) {
      const name = uniqueName(entry.name, used);
      const nameBuffer = Buffer.from(name, 'utf8');
      const data = Buffer.isBuffer(entry.data) ? entry.data : fs.readFileSync(entry.path);
      if (data.length > 0xffffffff) throw new Error(`ZIP entry is too large: ${name}`);
      const crc = crc32(data);
      const stamp = dosDateTime(entry.mtime || new Date());
      const header = localHeader(nameBuffer, crc, data.length, stamp);
      fs.writeSync(fd, header);
      fs.writeSync(fd, nameBuffer);
      fs.writeSync(fd, data);
      central.push(Buffer.concat([centralHeader(nameBuffer, crc, data.length, stamp, offset), nameBuffer]));
      offset += header.length + nameBuffer.length + data.length;
    }

    const centralOffset = offset;
    let centralSize = 0;
    for (const record of central) {
      fs.writeSync(fd, record);
      centralSize += record.length;
    }
    fs.writeSync(fd, endRecord(central.length, centralSize, centralOffset));
  } finally {
    fs.closeSync(fd);
  }
  return outputPath;
}

module.exports = { writeZip, safeZipPath, crc32 };
