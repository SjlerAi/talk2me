# Talk2Me OS2 Controlled Import Runbook

## Purpose

This runbook governs preview-only customer and mobile-service imports into `kloka_talk2me`. It protects the Master Customer model, keeps account number as the strongest grouping key, prevents silent merges, separates upload from approval and finalisation, and records every material action.

Production at `talk2me.uent.co.za` remains untouched. The import pipeline must never be pointed at the production database.

## Supported import shape

The current controlled pipeline accepts only:

```text
batchType: customer_services
```

Accepted source filenames end in `.csv`, `.json`, `.xls`, or `.xlsx`. The API receives parsed rows; it does not accept arbitrary file paths or execute spreadsheet content.

Each valid row requires:

```text
account number
customer display name
South African mobile number
```

Optional fields are email, town, package name, handset, next upgrade date, monthly amount, and customer type.

## Fixed limits

```text
maximum rows             5000
transaction chunk size   25
maximum request rows     1.5 MiB after canonical row serialization
maximum row size         64 KiB
maximum row keys         64
maximum JSON depth       8
maximum JSON nodes       1000
maximum review notes     5000 characters
```

The server JSON parser has its own 2 MiB ceiling. The route-level limit remains lower and fails closed.

## Matching policy

Account number is authoritative for grouping.

1. An exact active account match can become `safe_update`.
2. A matching mobile or email without the account match remains `ambiguous`.
3. An account match that conflicts with another customer identity remains `ambiguous`.
4. No account or identity match can become `safe_create`.
5. A duplicate normalized account inside the same batch becomes `duplicate`.
6. Invalid data remains `invalid`.

Mobile or email similarity must never silently merge two Master Customers.

## Sixty governed controls

1. Exactly 5,000 rows maximum.
2. Exactly 25 rows per staging chunk.
3. Canonical batch bytes are bounded.
4. Canonical row bytes are bounded.
5. Row key count is bounded.
6. JSON depth is bounded.
7. JSON node count is bounded.
8. Account numbers are normalized.
9. Unsafe account punctuation is rejected.
10. South African mobile numbers are normalized.
11. Invalid mobile numbers are rejected.
12. Emails are lowercased and validated.
13. Malformed emails are rejected.
14. Dates must be canonical `YYYY-MM-DD`.
15. Impossible calendar dates are rejected.
16. Money is finite, non-negative, bounded, and rounded to cents.
17. Negative money is rejected.
18. Canonical JSON serialization is deterministic.
19. Valid rows remain unresolved until database matching.
20. Valid rows must have no validation errors.
21. Normalized account values are retained.
22. Normalized mobile values are retained.
23. Customer type is restricted to `individual` or `business`.
24. Missing or invalid account numbers are rejected.
25. Missing or invalid mobile numbers are rejected.
26. Invalid email is recorded as a row error.
27. Invalid upgrade date is recorded as a row error.
28. Invalid monthly amount is recorded as a row error.
29. Duplicate accounts inside a batch are detected.
30. Duplicate rows retain an explicit validation reason.
31. The source digest is lowercase SHA-256.
32. The request body must be a plain object.
33. Filename path traversal is prohibited.
34. Filename extensions use an allowlist.
35. Only the supported batch type is accepted.
36. Prototype-pollution keys are rejected.
37. Non-finite JSON numbers are rejected.
38. Source hashing is deterministic and rename-resistant.
39. Duplicate source hashes are locked before insert.
40. Staging uses `SERIALIZABLE` isolation.
41. Staging uses controlled savepoints.
42. The exact `account_number_normalised` schema column is used.
43. Exact account match takes priority.
44. Identity-only matches require review.
45. Account-versus-identity conflicts require review.
46. Staging counts must reconcile.
47. Batch state transitions require one affected row.
48. Reject and override decisions require notes.
49. Override customer/account relationships are locked and verified.
50. Ambiguous rows require override or rejection.
51. Invalid and duplicate rows must be rejected.
52. The uploader cannot approve the batch.
53. Approval requires exact row-count agreement.
54. Finalisation requires the exact confirmation phrase.
55. The uploader cannot finalise the batch.
56. A retry processes failed rows only.
57. Every finalised row has its own savepoint.
58. Create and update paths recheck collisions under lock.
59. Ownership inheritance and transactional audit are recorded.
60. Finalisation counts must reconcile before completion.

## Stage operation

Required permission:

```text
import.upload
```

Endpoint:

```text
POST /api/os2/imports/stage
```

The route canonicalizes every row, rejects unsafe JSON, detects within-batch duplicate accounts, hashes the canonical content, refuses an existing source hash, creates the batch in `analysing`, and processes rows in 25-row savepoint chunks.

The batch moves to `review` only when safe, review, and rejected counts equal the total row count. A batch event and audit record are inserted in the same transaction.

## Review operation

Required permission:

```text
import.review
```

Endpoint:

```text
POST /api/os2/imports/:batchId/rows/:rowId/review
```

Rules:

- The batch must still be in `review`.
- The row must still be pending and unreviewed.
- Ambiguous rows accept only `override` or `reject`.
- Invalid and duplicate rows accept only `reject`.
- Override requires both a Master Customer ID and account ID.
- The account must belong to that customer and both must remain active.
- Reject and override require notes.
- The first successful decision wins; stale concurrent reviews fail.

## Approval operation

Required permission:

```text
import.finalise
```

Endpoint:

```text
POST /api/os2/imports/:id/approve
```

The uploader cannot approve their own batch. Approval requires:

- batch state `review`;
- exact database row count;
- no unresolved ambiguous, invalid, or duplicate rows;
- ambiguous rows resolved only by override or rejection;
- invalid and duplicate rows rejected;
- every override linked to a valid customer and account;
- no row already finalised.

## Finalisation operation

Required permission:

```text
import.finalise
```

Endpoint:

```text
POST /api/os2/imports/:id/finalise
```

Required body:

```json
{
  "confirmation": "FINALISE_IMPORT_BATCH"
}
```

The uploader cannot finalise. Initial finalisation accepts `approved`; retry accepts `failed` and processes only rows whose finalisation status is `failed`.

### Safe create

The route rechecks account, mobile-service, mobile-identity, and email-identity collisions under lock. It creates:

- one Master Customer;
- one customer account;
- one mobile service;
- primary mobile and optional email contacts;
- initial ownership history with change type `import`;
- transactional audit and import events.

Ownership is inherited from the batch uploader. The finalising user is recorded as the database actor.

### Safe update

The matched account and Master Customer must still agree with the normalized account number. The route refuses a mobile number already belonging to another customer.

Existing non-null customer and service values are not silently overwritten. The import fills missing values and creates a missing mobile service only when collision checks pass. Ownership is not changed.

### Failure handling

Each row uses an isolated savepoint. A failed row rolls back its own create/update work and receives a bounded error code. Successful or skipped rows are not replayed during a retry.

The batch becomes:

```text
completed   when error_rows = 0
failed      when one or more rows failed
```

A failed batch can be finalised again. Only failed rows are retried.

## Evidence and audit

Read endpoints:

```text
GET /api/os2/imports
GET /api/os2/imports/:id
GET /api/os2/imports/:id/events
```

The pipeline records batch staging, row review, approval, row finalisation, row skipping, row failure, and batch completion events. Master Customer creates and customer-account updates also receive central audit records.

Raw internal exception messages are not returned to the browser. Known controlled errors use bounded error codes; unknown errors use a generic operation failure.

## Hard stops

Stop when:

- the database is not `kloka_talk2me`;
- the branch is not `agent/talk2me-os2-integrated-rebuild`;
- production mutation is enabled;
- input limits are exceeded;
- account or identity evidence conflicts;
- a duplicate source hash exists;
- row counts do not reconcile;
- a reviewer supplies an invalid override target;
- the uploader attempts approval or finalisation;
- batch state changed concurrently;
- finalisation confirmation is absent;
- collision checks fail;
- finalisation totals do not reconcile.

This runbook documents source controls only. No import staging, review, approval, finalisation, preview migration, deployment, or UAT was executed as part of the source change.
