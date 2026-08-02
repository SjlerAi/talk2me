# Talk2Me OS2 Preview Security Operations Runbook

## Scope
This runbook applies only to `https://talk2me.kloka.co.za` and database `kloka_talk2me`.
It must never be used against `https://talk2me.uent.co.za/`.

## Before restart
1. Confirm the deployed branch is `agent/talk2me-os2-integrated-rebuild`.
2. Run `npm run check`.
3. Back up the preview database.
4. Run the controlled preview migration command.
5. Run `npm run verify:schema` and confirm at least eight migrations.
6. Confirm `os2_security_events`, `os2_login_attempts` and the new session columns exist.

## Security controls now enforced
- Request IDs on all responses.
- Content Security Policy and defensive browser headers.
- Same-origin checks for state-changing browser requests.
- General request-rate limiting.
- Stricter login-rate limiting.
- Temporary login blocking after repeated failures.
- Hashed login identities in security history.
- Revoked-session enforcement.
- Session last-seen, IP and user-agent tracking.
- Self-service revocation of other sessions.
- Manager-controlled staff session revocation.
- Redaction of secrets in security-event payloads.

## Verification after preview restart
1. Call `/health` and confirm version `0.28.0` and a request ID.
2. Confirm security headers are present.
3. Confirm anonymous integrated API access returns 401.
4. Sign in with a valid preview account.
5. Confirm `/api/auth/me` returns a request ID.
6. Confirm `/api/os2/security/sessions` shows only the signed-in user's sessions for staff users.
7. Confirm owner/manager users can view `/api/os2/security/summary`.
8. Confirm revoked sessions cannot access authenticated endpoints.
9. Confirm cross-origin state-changing requests are rejected.
10. Confirm failed login attempts create security events without storing the supplied password or raw identity.

## Incident response
1. Revoke the affected user's sessions.
2. Review recent high and critical security events.
3. Record the request ID, route, IP, user agent and timestamp.
4. Preserve relevant audit and security-event rows.
5. Reset the staff password outside this application if compromise is suspected.
6. Do not delete incident evidence during investigation.

## Rollback
Application rollback may use the previous preview commit, but database rollback must be assessed separately because migration 008 adds new tables and columns. Do not drop security tables while incident evidence may be required.

## Readiness rule
Security code is not considered operational until migration 008 has run, the preview application has restarted, and the verification steps above have passed.
