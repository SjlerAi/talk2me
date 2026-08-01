'use strict';

const crypto = require('crypto');
const path = require('path');
const pkg = require('./package.json');

const expectedBaseUrl = 'https://talk2me.kloka.co.za';
const expectedHost = 'talk2me.kloka.co.za';
const expectedDatabase = 'kloka_talk2me';
const expectedBranch = 'agent/talk2me-os2-integrated-rebuild';
const expectedNodeMajor = 20;
const requestTimeoutMs = 15000;
const maxResponseBytes = 2 * 1024 * 1024;
const maxResults = 40;
const baseUrl = String(process.env.UAT_BASE_URL || expectedBaseUrl).trim().replace(/\/$/, '');
const identity = String(process.env.UAT_IDENTITY || '').trim();
const password = String(process.env.UAT_PASSWORD || '');
const expectedCommitSha = String(process.env.UAT_EXPECTED_COMMIT_SHA || '').trim().toLowerCase();
const approvedSourceDigest = String(process.env.RELEASE_SOURCE_INVENTORY_SHA256 || '').trim().toLowerCase();
const branch = String(process.env.RELEASE_BRANCH || '').trim();
const database = String(process.env.DB_NAME || '').trim();
const allowMutations = String(process.env.UAT_ALLOW_MUTATIONS || '').toLowerCase() === 'true';
const runId = crypto.randomUUID();

function fail(message, details = {}) {
  console.error(JSON.stringify({
    ok: false,
    check: 'preview-uat',
    error: message,
    runId,
    baseUrl,
    branch: branch || null,
    database: database || null,
    allowMutations,
    completed: details.completed || [],
    productionMutationEnabled: false,
    mergeExecutionEnabled: false
  }, null, 2));
  process.exit(1);
}

function validateText(value, label, maxLength) {
  if (!value || value !== value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) fail(`${label}_INVALID`);
  return value;
}

function ensurePreviewIdentity() {
  let parsed;
  try { parsed = new URL(baseUrl); } catch { fail('UAT_BASE_URL_INVALID'); }
  if (baseUrl !== expectedBaseUrl) fail('REFUSING_NON_CANONICAL_PREVIEW_URL');
  if (parsed.protocol !== 'https:' || parsed.hostname !== expectedHost || parsed.port || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) fail('REFUSING_NON_PREVIEW_URL');
  if (database !== expectedDatabase) fail('PREVIEW_DATABASE_REQUIRED');
  if (branch !== expectedBranch) fail('CONTROLLED_BRANCH_REQUIRED');
  if (Number.parseInt(process.versions.node.split('.')[0], 10) !== expectedNodeMajor) fail('NODE_20_REQUIRED');
  if (!/^[0-9a-f]{40}$/.test(expectedCommitSha)) fail('UAT_EXPECTED_COMMIT_SHA_REQUIRED');
  if (!/^[0-9a-f]{64}$/.test(approvedSourceDigest)) fail('APPROVED_SOURCE_DIGEST_REQUIRED');
  if (String(process.env.ALLOW_PRODUCTION_MUTATION || '').toLowerCase() === 'true') fail('PRODUCTION_MUTATION_FLAG_PROHIBITED');
  if (String(process.env.ENABLE_CUSTOMER_MERGE_EXECUTION || '').toLowerCase() === 'true') fail('MERGE_EXECUTION_FLAG_PROHIBITED');
  validateText(identity, 'UAT_IDENTITY', 320);
  if (!password || password.length > 1024 || /[\u0000\r\n]/.test(password)) fail('UAT_PASSWORD_INVALID');
}

function safePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000\r\n]/.test(value)) fail('UAT_REQUEST_PATH_INVALID');
  const parsed = new URL(value, expectedBaseUrl);
  if (parsed.origin !== expectedBaseUrl) fail('UAT_REQUEST_ORIGIN_MISMATCH');
  return parsed.pathname + parsed.search;
}

async function readBoundedBody(response) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) fail('UAT_RESPONSE_DECLARED_TOO_LARGE');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxResponseBytes) fail('UAT_RESPONSE_TOO_LARGE');
  const text = bytes.toString('utf8');
  if (text.includes('\u0000')) fail('UAT_RESPONSE_NUL_PROHIBITED');
  return text;
}

async function request(requestPath, options = {}, cookie = '') {
  const normalizedPath = safePath(requestPath);
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) fail('UAT_HTTP_METHOD_PROHIBITED');
  const headers = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const started = Date.now();
  let response;
  try {
    response = await fetch(`${expectedBaseUrl}${normalizedPath}`, {
      method,
      headers,
      body: options.body,
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
  } catch (error) {
    fail(`UAT_REQUEST_FAILED:${error.name || 'Error'}`);
  }
  const elapsedMs = Date.now() - started;
  if (elapsedMs > requestTimeoutMs + 1000) fail('UAT_REQUEST_TIMEOUT_BOUND_EXCEEDED');
  if (response.status >= 300 && response.status < 400) fail(`UAT_REDIRECT_PROHIBITED:${normalizedPath}:${response.status}`);
  const responseUrl = new URL(response.url);
  if (responseUrl.origin !== expectedBaseUrl) fail('UAT_RESPONSE_ORIGIN_MISMATCH');
  const bodyText = await readBoundedBody(response);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  let body = null;
  if (bodyText) {
    if (!contentType.includes('application/json')) fail(`UAT_JSON_CONTENT_TYPE_REQUIRED:${normalizedPath}`);
    try { body = JSON.parse(bodyText); } catch { fail(`UAT_RESPONSE_INVALID_JSON:${normalizedPath}`); }
  }
  return { response, body, elapsedMs, contentType, path: normalizedPath };
}

function parseSessionCookie(setCookie) {
  if (!setCookie || /[\r\n]/.test(setCookie)) fail('SESSION_COOKIE_INVALID');
  const lower = setCookie.toLowerCase();
  if (!lower.includes('httponly')) fail('SESSION_COOKIE_HTTPONLY_REQUIRED');
  if (!lower.includes('secure')) fail('SESSION_COOKIE_SECURE_REQUIRED');
  if (!/samesite=(lax|strict)/i.test(setCookie)) fail('SESSION_COOKIE_SAMESITE_REQUIRED');
  if (/domain=/i.test(setCookie)) fail('SESSION_COOKIE_DOMAIN_ATTRIBUTE_PROHIBITED');
  const first = setCookie.split(';')[0];
  if (!/^os2_session=[A-Za-z0-9._~-]{16,4096}$/.test(first)) fail('SESSION_COOKIE_FORMAT_INVALID');
  return first;
}

function record(results, name, condition, details = {}) {
  if (results.length >= maxResults) fail('UAT_RESULT_LIMIT_EXCEEDED', { completed: results.map(item => item.name) });
  if (!condition) fail(`UAT_ASSERTION_FAILED:${name}`, { completed: results.map(item => item.name) });
  const item = { name, ok: true, ...details };
  results.push(item);
  console.log(`PASS ${name}`);
}

function requireNoStore(response, name) {
  const cacheControl = String(response.headers.get('cache-control') || '').toLowerCase();
  record([], `${name} cache control`, cacheControl.includes('no-store') || cacheControl.includes('private'), { cacheControl });
}

async function main() {
  ensurePreviewIdentity();
  const results = [];
  const startedAt = new Date().toISOString();

  const health = await request('/health');
  record(results, 'Health status', health.response.status === 200, { status: health.response.status, elapsedMs: health.elapsedMs });
  record(results, 'Health success body', health.body?.ok === true);
  record(results, 'Health application identity', health.body?.application === 'Talk2Me OS2 integrated rebuild');
  if (health.body?.version !== undefined) record(results, 'Health version identity', health.body.version === pkg.version, { version: health.body.version });
  if (health.body?.database !== undefined) record(results, 'Health database identity', health.body.database === expectedDatabase, { database: health.body.database });

  const anonymous = await request('/api/auth/me');
  record(results, 'Anonymous API blocked', anonymous.response.status === 401, { status: anonymous.response.status });
  record(results, 'Anonymous response has no session cookie', !anonymous.response.headers.get('set-cookie'));

  const invalidLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identity, password: `${password}__uat_invalid__` }) });
  record(results, 'Invalid login rejected', [400, 401, 403, 429].includes(invalidLogin.response.status), { status: invalidLogin.response.status });
  record(results, 'Invalid login does not issue session', !invalidLogin.response.headers.get('set-cookie'));

  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identity, password }) });
  record(results, 'Preview login', login.response.status === 200 && login.body?.ok === true, { status: login.response.status, elapsedMs: login.elapsedMs });
  const cookie = parseSessionCookie(login.response.headers.get('set-cookie') || '');
  record(results, 'Secure session cookie issued', true);

  const me = await request('/api/auth/me', {}, cookie);
  record(results, 'Authenticated session status', me.response.status === 200, { status: me.response.status });
  record(results, 'Authenticated user identity', Number.isInteger(Number(me.body?.user?.id)) && Number(me.body.user.id) > 0);
  record(results, 'Authenticated role present', typeof me.body?.user?.role === 'string' && me.body.user.role.length > 0, { role: me.body?.user?.role || null });
  record(results, 'Authenticated response does not rotate session unexpectedly', !me.response.headers.get('set-cookie'));

  const dashboard = await request('/api/dashboard', {}, cookie);
  record(results, 'Dashboard API', dashboard.response.status === 200 && dashboard.body?.metrics && typeof dashboard.body.metrics === 'object', { status: dashboard.response.status, elapsedMs: dashboard.elapsedMs });

  const search = await request('/api/os2/customers/search?q=uat-nonexistent-synthetic-marker', {}, cookie);
  record(results, 'Master Customer search', search.response.status === 200 && Array.isArray(search.body?.customers), { status: search.response.status, resultCount: search.body?.customers?.length ?? null });

  const work = await request('/api/os2/work-items', {}, cookie);
  record(results, 'My Work queue', work.response.status === 200 && Array.isArray(work.body?.workItems), { status: work.response.status, resultCount: work.body?.workItems?.length ?? null });

  const notifications = await request('/api/os2/notifications', {}, cookie);
  record(results, 'Notification feed', notifications.response.status === 200 && Array.isArray(notifications.body?.notifications), { status: notifications.response.status, resultCount: notifications.body?.notifications?.length ?? null });

  const calendar = await request('/api/os2/calendar', {}, cookie);
  record(results, 'Calendar feed', calendar.response.status === 200 && calendar.body !== null, { status: calendar.response.status, elapsedMs: calendar.elapsedMs });

  let mutationWorkItemId = null;
  if (allowMutations) {
    const marker = `UAT ${runId}`;
    const createWork = await request('/api/os2/work-items', {
      method: 'POST',
      body: JSON.stringify({ title: marker, type: 'task', priority: 'low', description: `Automated preview UAT record ${runId}` })
    }, cookie);
    mutationWorkItemId = Number(createWork.body?.workItemId);
    record(results, 'Create UAT work item', createWork.response.status === 201 && Number.isInteger(mutationWorkItemId) && mutationWorkItemId > 0, { status: createWork.response.status, workItemId: mutationWorkItemId || null });
    const transition = await request(`/api/os2/work-items/${mutationWorkItemId}/transition`, {
      method: 'POST',
      body: JSON.stringify({ toState: 'assigned', note: `Automated preview UAT transition ${runId}` })
    }, cookie);
    record(results, 'Transition UAT work item', transition.response.status === 200 && transition.body?.ok !== false, { status: transition.response.status, workItemId: mutationWorkItemId });
  } else {
    record(results, 'Mutation tests intentionally disabled', true);
  }

  const logout = await request('/api/auth/logout', { method: 'POST' }, cookie);
  record(results, 'Logout accepted', logout.response.status === 200 && logout.body?.ok === true, { status: logout.response.status });
  const clearedCookie = String(logout.response.headers.get('set-cookie') || '');
  record(results, 'Logout clears session cookie', /os2_session=/i.test(clearedCookie) && (/max-age=0/i.test(clearedCookie) || /expires=Thu, 01 Jan 1970/i.test(clearedCookie)));

  const afterLogout = await request('/api/auth/me', {}, cookie);
  record(results, 'Logged-out session rejected', afterLogout.response.status === 401, { status: afterLogout.response.status });

  const finishedAt = new Date().toISOString();
  console.log(JSON.stringify({
    ok: true,
    check: 'preview-uat',
    runId,
    application: pkg.name,
    version: pkg.version,
    expectedCommitSha,
    approvedSourceDigest,
    baseUrl: expectedBaseUrl,
    database: expectedDatabase,
    branch: expectedBranch,
    nodeVersion: process.versions.node,
    startedAt,
    finishedAt,
    allowMutations,
    mutationWorkItemId,
    total: results.length,
    passed: results.length,
    failed: 0,
    results,
    requestTimeoutMs,
    responseBytesBounded: true,
    redirectsProhibited: true,
    crossOriginResponsesProhibited: true,
    jsonContentTypeRequired: true,
    invalidLoginChecked: true,
    secureSessionCookieVerified: true,
    logoutSessionInvalidationVerified: true,
    sourceIdentityRecorded: true,
    productionMutationEnabled: false,
    mergeExecutionEnabled: false
  }, null, 2));
}

main().catch(error => fail(`UNEXPECTED_UAT_ERROR:${error.message}`));
