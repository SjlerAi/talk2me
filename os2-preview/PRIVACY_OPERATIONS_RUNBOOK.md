# Talk2Me OS2 Privacy Operations Runbook

## Scope
This runbook applies only to the controlled preview application and preview database `kloka_talk2me`.

## Roles
- Owner: full privacy, export and retention authority.
- Manager: may review, decide and complete privacy requests.
- Admin: may capture requests and consent records but may not approve or complete requests.
- Staff: no privacy administration access.

## Data subject request process
1. Identify the Master Customer before creating a request.
2. Record the request type and supplied details.
3. The system assigns a unique request reference and a 30-day target date.
4. Move the request through identity verification and review.
5. The creator may not approve, reject or complete their own request.
6. Record a clear reason for any rejection.
7. Complete the request only after the required correction, restriction, objection, deletion review or export has been performed.

## Access and export requests
- Only `access` and `export` requests may generate an export job.
- Exports are queued and expire after seven days.
- Export files must be stored outside the public web directory.
- The final file must have a SHA-256 checksum recorded before release.
- Never email an unencrypted export as an attachment.
- Record the release channel and recipient verification evidence in the request notes.

## Correction requests
- Verify the requested correction against supporting evidence.
- Preserve the original value in the audit history.
- Apply the correction through the normal Master Customer or service workflow.
- Mark the request completed only after the audit entry is confirmed.

## Restriction and objection requests
- Use customer restrictions to prevent affected actions while the request is reviewed.
- Do not remove an active restriction without management approval.
- Record the legal or operational reason for retaining any processing activity.

## Deletion requests
- A deletion request does not permit immediate physical deletion.
- Review legal, accounting, contractual and fraud-prevention retention requirements first.
- Prefer archive or anonymisation where records must be retained.
- Never delete audit history required to prove prior actions.
- Any physical deletion must be executed through a separately approved maintenance procedure with a backup and rollback plan.

## Consent records
- Record the consent type, status, source and evidence reference.
- A withdrawal must create a new consent record rather than overwrite history.
- Operational processing that does not rely on consent should be marked `not_required` only after management review.

## Retention review
- Retention policies define the entity type, retention period and intended action.
- The system creates review records; it does not silently delete data.
- Every review requires a decision and reason.
- `delete` decisions require an external approved maintenance action.

## Evidence and audit
For every request retain:
- request reference;
- identity verification evidence reference;
- decision maker;
- decision date;
- reason;
- export checksum where applicable;
- completion evidence;
- audit-log entries.

## Preview validation
Before UAT:
1. Run `npm run check:privacy`.
2. Run the full `npm run check` suite.
3. Apply migration 009 only to `kloka_talk2me`.
4. Run `npm run verify:schema`.
5. Test owner, manager, admin and staff permissions separately.

## Production protection
Do not copy or execute migration 009 against the production database until preview migration, schema verification, security testing and privacy UAT have all passed and a separate production change approval has been recorded.