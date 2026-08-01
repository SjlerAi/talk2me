# Talk2Me OS2 Preview UAT Runbook

This runbook applies only to `https://talk2me.kloka.co.za` and database `kloka_talk2me`.

## Preconditions

1. Confirm the checked-out branch is `agent/talk2me-os2-integrated-rebuild`.
2. Confirm production has not been changed.
3. Back up the preview database.
4. Install dependencies in `os2-preview`.
5. Run `npm run check`.
6. Run `npm run check:readiness`.
7. Run preview migrations only with `ALLOW_PREVIEW_MIGRATIONS=true`.
8. Run `npm run verify:schema` after migrations.
9. Restart only the preview Node.js application.
10. Confirm `/health` returns the expected OS2 version and connected preview database.

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

- Confirm only assigned/owned work and customer actions are available.
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

- test date and tester;
- role used;
- customer or work-item reference;
- expected result;
- actual result;
- screenshot or error detail;
- pass, fail or deferred status.

Do not declare the rebuild ready until schema verification, automated UAT, role-based UAT, import UAT and controlled email testing all pass on the preview environment.
