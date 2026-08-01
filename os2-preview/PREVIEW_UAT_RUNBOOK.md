# Talk2Me OS2 Preview UAT Runbook

This runbook applies only to `https://talk2me.kloka.co.za` and database `kloka_talk2me`.

## Preconditions

1. Confirm the checked-out branch is `agent/talk2me-os2-integrated-rebuild` and record the exact commit SHA.
2. Confirm production `talk2me.uent.co.za` has not been changed.
3. Confirm a reviewed `package-lock.json` is committed and dependencies were installed with `npm ci`.
4. Retain the exact CI workspace source-integrity evidence and approved `RELEASE_SOURCE_INVENTORY_SHA256`.
5. Confirm a current verified preview backup exists and retain its reference and SHA-256.
6. Confirm the one-time migration ledger bootstrap was executed only through `npm run bootstrap:migration-ledger`.
7. Verify the private bootstrap evidence pair with `npm run verify:migration-ledger-bootstrap-evidence`.
8. Confirm the migration command used the same absolute `MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH` and re-ran the evidence verifier before opening MySQL.
9. Confirm the final migration result reports `bootstrapEvidenceVerifiedBeforeDatabaseConnection: true`, `advisoryLockReleased: true`, `advisoryLockFreeAfterRelease: true`, and `databaseConnectionClosedBeforeSuccess: true`.
10. Run `npm run check`.
11. Run `npm run check:readiness`.
12. Run `npm run check:deployment`.
13. Run `npm run check:uat-gate`.
14. Run the controlled `verify:preview-data` command after migrations with complete preview database identity.
15. Confirm the orchestrator completed `schema-verification.js` first and `merge-restore-evidence-verification.js` second.
16. Confirm the successful result identifies `kloka_talk2me`, proves exact migration-ledger and restore-evidence semantics, and reports `mergeExecutionEnabled: false`.
17. Re-run approved source-integrity verification immediately before UAT starts.
18. Confirm that immediate verification completes within 30 seconds and reports `exactApprovedInventoryMatched: true` and `packageLockPresent: true`.
19. Restart only the preview Node.js application.
20. Confirm `/health` returns the expected OS2 application identity and, where exposed, the expected preview version and database.

Any source change after retained CI evidence invalidates that UAT attempt. This includes application code, governance checks, runbooks, package metadata, the dependency lock, bootstrap source, migrations, or any other protected file.

Do not begin automated or manual UAT when the approved source digest is absent, malformed, belongs to a different CI build, or does not exactly match the current protected source inventory.

Do not begin UAT when `package-lock.json` is absent from the approved protected inventory, when bootstrap evidence is absent, altered, unverifiable, points to a different bootstrap source, or was not verified by the migration runner before its database connection.

Do not treat individual `applied <migration>` messages as migration completion evidence. Only the final post-cleanup JSON success record confirms advisory-lock release, post-release free-lock verification, complete ledger reconciliation, and database connection closure.

Do not begin UAT when the preview data-verification orchestrator fails, is interrupted, or has not been run. Running only `npm run verify:schema` is not sufficient because pinned restore evidence must be verified in the same controlled sequence.

## Approved source verification command

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
RELEASE_SOURCE_INVENTORY_SHA256=<approved-ci-inventory-sha256> \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run verify:release-source-integrity
```

Retain the complete output as a separate immediate pre-UAT evidence item. An earlier successful result is not sufficient after migration, preview-data verification, manual intervention, dependency work, or any other step that could affect protected source state.

## Controlled automated UAT command

Set temporary preview-only credentials and exact source identity in the shell environment:

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
DB_NAME=kloka_talk2me \
UAT_BASE_URL=https://talk2me.kloka.co.za \
UAT_IDENTITY=<preview-test-username-or-email> \
UAT_PASSWORD=<preview-test-password> \
UAT_EXPECTED_COMMIT_SHA=<exact-40-character-commit-sha> \
RELEASE_SOURCE_INVENTORY_SHA256=<approved-64-character-source-digest> \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run uat:preview
```

The UAT runner refuses any non-canonical URL, alternate port, embedded credentials, query string, fragment, wrong branch, wrong database, non-Node-20 runtime, missing exact commit SHA, missing approved source digest, enabled production mutation, or enabled customer-merge execution.

## Network and response controls

Every automated UAT request has a 15-second request timeout and a 2 MiB response limit. Declared and actual response sizes are checked.

The runner permits only `GET` and `POST` requests, validates every request path, fixes the origin to `https://talk2me.kloka.co.za`, disables request caching, and does not send ambient browser credentials.

HTTP redirects are prohibited. Cross-origin responses are prohibited. TLS verification may not be disabled. API response bodies must use JSON content type, parse as valid JSON, contain no NUL bytes, and remain within the response-size limit.

A timeout, network failure, redirect, wrong origin, oversized response, invalid content type, malformed JSON, failed assertion, or unexpected child condition stops the UAT run immediately.

## Authentication and session tests

The runner tests authentication in this order:

1. Anonymous `/api/auth/me` must return `401` and must not issue a session cookie.
2. An invalid-login attempt must be rejected and must not issue a session cookie.
3. The valid preview login must return success.
4. The session cookie must use the expected `os2_session` name and bounded token format.
5. The cookie must include `HttpOnly`.
6. The cookie must include `Secure`.
7. The cookie must include `SameSite=Lax` or `SameSite=Strict`.
8. A broad `Domain` cookie attribute is prohibited.
9. The authenticated endpoint must return a positive user ID and a non-empty role.
10. Ordinary authenticated reads must not unexpectedly rotate the session cookie.
11. Logout must succeed.
12. Logout must clear the session cookie through zero max-age or an expired date.
13. Reuse of the old session after logout must return `401`.

The runner does not print the credential or session-token value in its final JSON evidence.

## Read-only operational coverage

The read-only run verifies:

- health status and application identity;
- anonymous access rejection;
- invalid-login handling;
- secure authenticated login;
- current-user identity and role;
- dashboard metrics object;
- Master Customer search array;
- My Work queue array;
- notification feed array;
- calendar response;
- logout and server-side session invalidation.

The customer-search query uses a synthetic non-existent marker to avoid exposing or depending on a real customer record.

## Controlled mutation UAT

Mutation testing is disabled by default. Enable it only against preview by adding:

```text
UAT_ALLOW_MUTATIONS=true
```

A mutation run creates a clearly marked work item whose title and description contain the UAT run UUID. It then attempts the controlled transition to `assigned` and records the mutation work-item ID in final evidence.

The generated record must be reviewed and archived after the test. A mutation run may never be used against production and does not enable customer-merge execution.

## Automated evidence

Every successful automated run records:

- UAT run UUID;
- exact commit SHA and preview version;
- approved `RELEASE_SOURCE_INVENTORY_SHA256`;
- exact preview URL, database and branch;
- Node.js version;
- start and finish timestamps;
- mutation-enabled state;
- mutation work-item ID when applicable;
- every passed assertion and selected timing or result-count detail;
- request timeout and response-size controls;
- redirect and cross-origin prohibition;
- JSON content-type enforcement;
- secure-cookie verification;
- logout session invalidation;
- production mutation disabled;
- customer-merge execution disabled.

A console line marked `PASS` is progress output. Only the final JSON object with `ok: true`, `failed: 0`, complete result inventory, exact source identity and all safety markers is automated UAT completion evidence.

## Manual role-based UAT

Test with separate Owner, Manager, Admin and Staff accounts.

### Owner

- Open the integrated dashboard and Customer workspace.
- Search by customer name, account number and mobile number.
- Open Customer 360 and review accounts, services, restrictions, representatives, documents and history.
- Review approvals, claims, broadcasts, reports and email queue.

### Manager

- Confirm management visibility without owner-only destructive rights.
- Approve a test claim or approval request created by another user.
- Confirm self-approval is blocked.
- Review team calendar, attendance correction and opportunity reports.

### Admin

- Confirm operational access matches configured permissions.
- Confirm restricted management decisions remain blocked.

### Staff

- Confirm only assigned or owned work and customer actions are available.
- Create and update a test work item.
- Request a customer claim.
- Confirm arbitrary reassignment, approval decisions and broadcasts are blocked.

## Service, restriction, import and communications UAT

Use dedicated preview records and synthetic data only.

- Add mobile and fixed services and confirm duplicate protections.
- Apply a restriction and confirm the action is blocked or routed for approval.
- Approve from a different authorised user and confirm audit history.
- Use a small synthetic spreadsheet; confirm staging, classification, chunk processing, ambiguity handling and exception finalisation.
- Confirm no silent customer merges occur.
- Keep the email worker disabled initially; verify queueing before controlled test delivery.

## Acceptance evidence

Record for every scenario:

- exact commit SHA and preview version;
- approved `RELEASE_SOURCE_INVENTORY_SHA256`;
- retained CI source-integrity JSON and checksum sidecar;
- successful immediate pre-UAT source-integrity verification output;
- verified backup reference and SHA-256;
- bootstrap evidence path and bootstrap source SHA-256;
- final migration completion result;
- preview data-verification result and exact verifier order;
- UAT run UUID and mutation work-item ID where applicable;
- test date, tester and role used;
- customer or work-item reference;
- expected and actual result;
- screenshot or error detail;
- pass, fail or deferred status.

Do not declare the rebuild ready until dependency freeze, immediate approved source-integrity verification, bootstrap evidence verification, controlled migration completion, preview data verification, automated UAT, role-based UAT, import UAT and controlled email testing all pass on the preview environment.
