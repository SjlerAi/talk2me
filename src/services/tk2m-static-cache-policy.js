'use strict';

const path = require('node:path');

// CSS and JS are public application resources, not CRM records or attachments.
// Release-addressed assets may be reused safely; every other response fails
// closed to no-store, including private pages, JSON and unversioned assets.
function cacheControlForStatic({ live, root, file, requestUrl, releaseVersion }) {
  if (!live || !root || !file || !releaseVersion) return 'no-store';
  const relative = path.relative(root, file).replace(/\\/g, '/');
  if (!/^(?:css\/[^?#]+\.css|js\/[^?#]+\.js)$/.test(relative)) return 'no-store';
  let version = '';
  try { version = new URL(requestUrl || '/', 'https://crm.tk2m.co.za').searchParams.get('v') || ''; }
  catch (_) { return 'no-store'; }
  if (version !== releaseVersion && !version.startsWith(releaseVersion + '-')) return 'no-store';
  return 'public, max-age=604800, immutable';
}

module.exports = { cacheControlForStatic };
