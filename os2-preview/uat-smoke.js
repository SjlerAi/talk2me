const assert = require('node:assert/strict');

const baseUrl = String(process.env.OS2_BASE_URL || 'https://talk2me.kloka.co.za').replace(/\/$/, '');
const identity = String(process.env.OS2_UAT_IDENTITY || '').trim();
const password = String(process.env.OS2_UAT_PASSWORD || '');
const timeoutMs = Math.max(3000, Number(process.env.OS2_UAT_TIMEOUT_MS || 15000));
const overallTimeoutMs = Math.max(15000, Number(process.env.OS2_UAT_OVERALL_TIMEOUT_MS || 90000));

const overallTimer = setTimeout(() => {
  console.error(`UAT smoke test failed: overall test exceeded ${overallTimeoutMs}ms`);
  process.exit(1);
}, overallTimeoutMs);

async function request(path, options = {}) {
  console.log(`Checking ${path} ...`);
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    ...options,
    headers: {
      Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
      ...(options.headers || {})
    }
  });
  console.log(`  ${response.status} ${path}`);
  return response;
}

function cookieFrom(response) {
  const raw = response.headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

async function expectStatus(path, statuses, options = {}) {
  const response = await request(path, options);
  assert.ok(statuses.includes(response.status), `${path} returned ${response.status}; expected ${statuses.join(' or ')}`);
  return response;
}

async function runPublicChecks() {
  console.log('Running public and security checks...');
  const health = await expectStatus('/health', [200]);
  const healthBody = await health.json();
  assert.equal(healthBody.application, 'Talk2Me OS2', 'Health endpoint returned the wrong application name');
  assert.equal(healthBody.database?.connected, true, 'Database is not connected');

  await expectStatus('/login', [200]);
  await expectStatus('/os2.js', [200]);
  await expectStatus('/launcher-runtime.js', [200]);
  await expectStatus('/reports.js', [200]);
  await expectStatus('/administration.js', [200]);

  const protectedApi = await expectStatus('/api/auth/me', [401]);
  const protectedBody = await protectedApi.json();
  assert.equal(protectedBody.error, 'AUTHENTICATION_REQUIRED', 'Protected API did not reject an anonymous request correctly');
}

async function runAuthenticatedChecks() {
  if (!identity || !password) {
    console.log('Authenticated checks skipped: set OS2_UAT_IDENTITY and OS2_UAT_PASSWORD.');
    return;
  }

  console.log('Running authenticated checks...');
  const login = await expectStatus('/api/auth/login', [200], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password })
  });
  const loginBody = await login.json();
  assert.equal(loginBody.ok, true, 'Login response was not successful');
  const cookie = cookieFrom(login);
  assert.ok(cookie.startsWith('os2_session='), 'Login did not return the OS2 session cookie');

  const authHeaders = { Cookie: cookie };
  const endpoints = [
    '/api/auth/me',
    '/api/dashboard',
    '/api/my-work',
    '/api/attendance',
    '/api/opportunities?type=upgrades&days=7',
    '/api/reports/summary?days=30',
    '/api/reports/table?report=inquiries&days=30',
    '/api/launchers'
  ];

  for (const endpoint of endpoints) {
    const response = await expectStatus(endpoint, [200], { headers: authHeaders });
    const body = await response.json();
    assert.equal(body.ok, true, `${endpoint} returned ok=false`);
  }

  const meResponse = await request('/api/auth/me', { headers: authHeaders });
  const me = await meResponse.json();
  if (['owner', 'manager'].includes(me.user?.role)) {
    const admin = await expectStatus('/api/administration', [200], { headers: authHeaders });
    const adminBody = await admin.json();
    assert.equal(adminBody.ok, true, 'Administration endpoint returned ok=false');
  }

  await expectStatus('/api/auth/logout', [200], { method: 'POST', headers: authHeaders });
}

(async () => {
  console.log(`Talk2Me OS2 UAT smoke test: ${baseUrl}`);
  console.log(`Per-request timeout: ${timeoutMs}ms`);
  console.log(`Overall timeout: ${overallTimeoutMs}ms`);
  await runPublicChecks();
  await runAuthenticatedChecks();
  clearTimeout(overallTimer);
  console.log('UAT smoke test passed.');
  process.exit(0);
})().catch(error => {
  clearTimeout(overallTimer);
  const detail = error.name === 'TimeoutError' ? `request exceeded ${timeoutMs}ms` : error.message;
  console.error(`UAT smoke test failed: ${detail}`);
  process.exit(1);
});
