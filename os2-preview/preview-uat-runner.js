'use strict';

const assert = require('assert');

const baseUrl = String(process.env.UAT_BASE_URL || 'https://talk2me.kloka.co.za').replace(/\/$/, '');
const identity = String(process.env.UAT_IDENTITY || '');
const password = String(process.env.UAT_PASSWORD || '');
const allowMutations = process.env.UAT_ALLOW_MUTATIONS === 'true';
const expectedHost = 'talk2me.kloka.co.za';

function ensurePreviewUrl() {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost) {
    throw new Error(`REFUSING_NON_PREVIEW_URL: ${baseUrl}`);
  }
}

async function request(path, options = {}, cookie = '') {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers, redirect: 'manual' });
  const bodyText = await response.text();
  let body = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = bodyText; }
  return { response, body };
}

function record(results, name, ok, detail) {
  results.push({ name, ok, detail: detail || null });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

async function main() {
  ensurePreviewUrl();
  if (!identity || !password) throw new Error('UAT_IDENTITY_AND_PASSWORD_REQUIRED');
  const results = [];

  const health = await request('/health');
  record(results, 'Health endpoint', health.response.status === 200 && health.body?.ok === true, `status=${health.response.status}`);
  assert.equal(health.body?.application, 'Talk2Me OS2 integrated rebuild');

  const anonymous = await request('/api/auth/me');
  record(results, 'Anonymous API blocked', anonymous.response.status === 401, `status=${anonymous.response.status}`);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identity, password })
  });
  record(results, 'Preview login', login.response.status === 200 && login.body?.ok === true, `status=${login.response.status}`);
  assert(login.response.status === 200, 'Login failed');
  const setCookie = login.response.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  assert(cookie.includes('os2_session='), 'Session cookie not issued');

  const me = await request('/api/auth/me', {}, cookie);
  record(results, 'Authenticated session', me.response.status === 200 && me.body?.user?.id, `role=${me.body?.user?.role || 'unknown'}`);

  const dashboard = await request('/api/dashboard', {}, cookie);
  record(results, 'Dashboard API', dashboard.response.status === 200 && dashboard.body?.metrics, `status=${dashboard.response.status}`);

  const search = await request('/api/os2/customers/search?q=test', {}, cookie);
  record(results, 'Master Customer search', search.response.status === 200 && Array.isArray(search.body?.customers), `status=${search.response.status}`);

  const work = await request('/api/os2/work-items', {}, cookie);
  record(results, 'My Work queue', work.response.status === 200 && Array.isArray(work.body?.workItems), `status=${work.response.status}`);

  const notifications = await request('/api/os2/notifications', {}, cookie);
  record(results, 'Notification feed', notifications.response.status === 200 && Array.isArray(notifications.body?.notifications), `status=${notifications.response.status}`);

  const calendar = await request('/api/os2/calendar', {}, cookie);
  record(results, 'Calendar feed', calendar.response.status === 200, `status=${calendar.response.status}`);

  if (allowMutations) {
    const marker = `UAT ${new Date().toISOString()}`;
    const createWork = await request('/api/os2/work-items', {
      method: 'POST',
      body: JSON.stringify({ title: marker, type: 'task', priority: 'low', description: 'Automated preview UAT record' })
    }, cookie);
    record(results, 'Create UAT work item', createWork.response.status === 201 && createWork.body?.workItemId, `status=${createWork.response.status}`);
    if (createWork.body?.workItemId) {
      const transition = await request(`/api/os2/work-items/${createWork.body.workItemId}/transition`, {
        method: 'POST',
        body: JSON.stringify({ toState: 'assigned', note: 'Automated preview UAT transition' })
      }, cookie);
      record(results, 'Transition UAT work item', transition.response.status === 200, `status=${transition.response.status}`);
    }
  } else {
    record(results, 'Mutation tests intentionally disabled', true, 'set UAT_ALLOW_MUTATIONS=true only on preview');
  }

  const logout = await request('/api/auth/logout', { method: 'POST' }, cookie);
  record(results, 'Logout', logout.response.status === 200 && logout.body?.ok === true, `status=${logout.response.status}`);

  const failed = results.filter(item => !item.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, baseUrl, allowMutations, total: results.length, failed }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch(error => {
  console.error(`PREVIEW UAT FAILED: ${error.message}`);
  process.exit(1);
});
