# Talk2Me OS2 Preview UAT Runbook

This runbook applies only to `https://talk2me.kloka.co.za` and database `kloka_talk2me`.

## Preconditions

1. Confirm the checked-out branch is `agent/talk2me-os2-integrated-rebuild`.
2. Confirm production has not been changed.
3. Confirm a current verified preview backup exists.
4. Confirm the one-time migration ledger bootstrap was executed only through `npm run bootstrap:migration-ledger`.
5. Verify the private bootstrap evidence pair with `npm run verify:migration-ledger-bootstrap-evidence`.
6. Confirm the migration command used the same absolute `MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH` and re-ran the evidence verifier before opening MySQL.
7. Confirm the final migration result reports `bootstrapEvidenceVerifiedBeforeDatabaseConnection: true`, `advisoryLockReleased: true`, and `databaseConnectionClosedBeforeSuccess: true`.
8. Install dependencies in `os2-preview` only with the committed dependency lock and `npm ci`.
9. Run `npm run check`.
10. Run `npm run check:readiness`.
11. Run `npm run check:deployment`.
12. Run `npm run check:uat-gate`.
13. Run `DB_NAME=kloka_talk2me npm run verify:preview-data` after migrations.
14. Confirm the orchestrator completed `schema-verification.js` first and `merge-restore-evidence-verification.js` second.
15. Confirm the successful result identifies `kloka_talk2me` and reports `mergeExecutionEnabled: false`.
16. Restart only the preview Node.js application.
17. Confirm `/health` returns the expected OS2 version and connected preview database.

Do not begin automated or manual UAT when bootstrap evidence is absent, altered, unverifiable, points to a different bootstrap source, or was not verified by the migration runner before its database connection.

Do not treat individual `applied <migration>` messages as migration completion evidence. Only the final post-cleanup JSON success record confirms that the advisory lock was released and the database connection was closed.

Do not begin UAT when the preview data-verification orchestrator fails, is interrupted, or has not been run. Running only `npm run verify:schema` is not sufficient because pinned restore evidence must be verified in the same controlled sequence.

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

The runner verifies:

- health endpoint;
- anonymous API rejection;
- authenticated login and session cookie;
- current-user endpoint;
- dashboard;
- Master Customer search;
- My Work queue;
- notification feed;
- calendar feed;
- logout.

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
- Search for a customer by name, account number and mobile number.
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

## Service and restriction UAT

Use a dedicated preview customer record.

- Add mobile and fixed services.
- Confirm duplicate mobile, MAC, solution ID and order number protections.
- Apply a customer restriction and confirm the restricted action is blocked or routed for approval.
- Approve from a different authorised user.
- Confirm service-change and audit history.

## Import UAT

- Use a small synthetic spreadsheet only.
- Confirm staging, classification and chunk processing.
- Confirm ambiguous rows enter the exception queue.
- Confirm finalisation is blocked until exceptions are decided.
- Confirm no silent customer merges occur.

## Communications UAT

Keep the email worker disabled for initial UAT.

- Verify in-app notifications and broadcasts.
- Generate a daily digest.
- Confirm email records enter the queue without sending.
- Configure preview SMTP only after queue review.
- Send only to controlled test addresses.

## Acceptance evidence

Record for every scenario:

- exact commit SHA and preview version;
- verified backup reference and SHA-256;
- bootstrap evidence path and bootstrap source SHA-256;
- final migration completion result showing evidence verification, lock release and connection closure;
- preview data-verification result and execution order;
- test date and tester;
- role used;
- customer or work-item reference;
- expected result;
- actual result;
- screenshot or error detail;
- pass, fail or deferred status.

Do not declare the rebuild ready until dependency freeze, bootstrap evidence verification, controlled migration completion, preview data verification, automated UAT, role-based UAT, import UAT and controlled email testing all pass on the preview environment.
