# Talk2Me OS2 Preview UAT Runbook

This runbook applies only to `https://talk2me.kloka.co.za` and database `kloka_talk2me`.

## Preconditions

1. Confirm the checked-out branch is `agent/talk2me-os2-integrated-rebuild` and record the exact commit SHA.
2. Confirm production `talk2me.uent.co.za` has not been changed.
3. Confirm a reviewed `package-lock.json` is committed and dependencies were installed with `npm ci`.
4. Retain the exact CI workspace source-integrity evidence and approved `RELEASE_SOURCE_INVENTORY_SHA256`.
5. Run `npm run verify:release-source-integrity` against the exact candidate checkout with `PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview`, `DB_NAME=kloka_talk2me`, the controlled branch, production mutation disabled, and customer-merge execution disabled.
6. Confirm release source verification completes within the 30-second limit, reports `exactApprovedInventoryMatched: true`, and confirms `packageLockPresent: true`.
7. Confirm a current verified preview backup exists and retain its reference and SHA-256.
8. Confirm the one-time migration ledger bootstrap was executed only through `npm run bootstrap:migration-ledger`.
9. Verify the private bootstrap evidence pair with `npm run verify:migration-ledger-bootstrap-evidence`.
10. Confirm the migration command used the same absolute `MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH` and re-ran the evidence verifier before opening MySQL.
11. Confirm the final migration result reports `bootstrapEvidenceVerifiedBeforeDatabaseConnection: true`, `advisoryLockReleased: true`, and `databaseConnectionClosedBeforeSuccess: true`.
12. Run `npm run check`.
13. Run `npm run check:readiness`.
14. Run `npm run check:deployment`.
15. Run `npm run check:uat-gate`.
16. Run `DB_NAME=kloka_talk2me npm run verify:preview-data` after migrations.
17. Confirm the orchestrator completed `schema-verification.js` first and `merge-restore-evidence-verification.js` second.
18. Confirm the successful result identifies `kloka_talk2me` and reports `mergeExecutionEnabled: false`.
19. Restart only the preview Node.js application.
20. Confirm `/health` returns the expected OS2 version and connected preview database.

Do not begin automated or manual UAT when the approved source digest is absent, malformed, belongs to a different CI build, or does not exactly match the current protected source inventory.

Do not begin UAT when `package-lock.json` is absent from the approved protected inventory, when bootstrap evidence is absent, altered, unverifiable, points to a different bootstrap source, or was not verified by the migration runner before its database connection.

Do not treat individual `applied <migration>` messages as migration completion evidence. Only the final post-cleanup JSON success record confirms that the advisory lock was released and the database connection was closed.

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

Retain the complete output. A source digest mismatch requires a new CI validation and evidence cycle before UAT can continue.

## Read-only automated UAT

Set temporary preview-only credentials in the shell environment:

```text
UAT_BASE_URL=https://talk2me.kloka.co.za
UAT_IDENTITY=<preview test username or email>
UAT_PASSWORD=<preview test password>
```

Run:

```text
npm run uat:preview
```

The runner verifies the health endpoint, anonymous API rejection, authenticated login and session cookie, current-user endpoint, dashboard, Master Customer search, My Work queue, notification feed, calendar feed, and logout.

## Controlled mutation UAT

Mutation testing is disabled by default. Enable it only against the preview site:

```text
UAT_ALLOW_MUTATIONS=true npm run uat:preview
```

This creates a clearly marked UAT work item and attempts a valid lifecycle transition. The generated record must be reviewed and archived after the test.

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
- successful release source-integrity verification output;
- verified backup reference and SHA-256;
- bootstrap evidence path and bootstrap source SHA-256;
- final migration completion result showing evidence verification, lock release and connection closure;
- preview data-verification result and execution order;
- test date, tester and role used;
- customer or work-item reference;
- expected and actual result;
- screenshot or error detail;
- pass, fail or deferred status.

Do not declare the rebuild ready until dependency freeze, approved source-integrity verification, bootstrap evidence verification, controlled migration completion, preview data verification, automated UAT, role-based UAT, import UAT and controlled email testing all pass on the preview environment.
