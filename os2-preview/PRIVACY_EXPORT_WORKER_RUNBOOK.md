# Talk2Me OS2 Privacy Export Worker Runbook

## Purpose

This runbook governs privacy export generation for the preview application at `talk2me.kloka.co.za`, database `kloka_talk2me`, and branch `agent/talk2me-os2-integrated-rebuild`.

Production at `talk2me.uent.co.za` remains untouched. The worker has no production authority and customer-merge execution remains disabled.

## Fixed identity

```text
application root: /home/kloka/repositories/talk2me/os2-preview
database:         kloka_talk2me
branch:           agent/talk2me-os2-integrated-rebuild
Node.js:          20.x
maximum attempts: 3
stale claim age:  20 minutes
```

## Required environment

```text
DB_HOST=localhost
DB_PORT=3306
DB_USER=kloka_talk
DB_PASSWORD=...
DB_NAME=kloka_talk2me
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild
PRIVACY_EXPORT_WORKER_ENABLED=true
PRIVACY_EXPORT_DIR=/home/kloka/repositories/talk2me/private/privacy-exports
PRIVACY_EXPORT_BATCH_SIZE=3
PRIVACY_EXPORT_INTERVAL_MS=30000
PRIVACY_EXPORT_RUN_ONCE=false
ALLOW_PRODUCTION_MUTATION=false
ENABLE_CUSTOMER_MERGE_EXECUTION=false
```

Boolean settings accept only `true` or `false`. Numeric settings must contain digits only and remain inside their governed ranges.

## Private storage preparation

The parent directory must already exist and belong to the application account. Create the export root outside `os2-preview`, outside `public`, and outside every `public_html` directory:

```bash
mkdir -p /home/kloka/repositories/talk2me/private
chmod 700 /home/kloka/repositories/talk2me/private
mkdir -p /home/kloka/repositories/talk2me/private/privacy-exports
chmod 700 /home/kloka/repositories/talk2me/private/privacy-exports
```

The worker verifies canonical paths, ownership, private modes, symbolic-link absence, descriptor identity, and `O_DIRECTORY | O_NOFOLLOW` support. It sets process umask `077`.

## Sixty governed controls

1. Exact preview database identity is required.
2. Exact controlled branch identity is required.
3. Explicit worker enablement is required.
4. Production mutation is prohibited.
5. Customer-merge execution is prohibited.
6. Database host is required.
7. Database user is required.
8. Database port is restricted to 1–65535.
9. Batch size is restricted to 1–10.
10. Polling interval is restricted to 10 seconds–1 hour.
11. Run-once mode uses strict Boolean parsing.
12. Export root must be absolute and normalized.
13. `public_html` export locations are prohibited.
14. Public asset locations are prohibited.
15. Application source locations are prohibited.
16. Export directories require mode `0700`.
17. Export directories must be canonical.
18. Directory symbolic links are prohibited.
19. Directory ownership must match the worker account.
20. Directory descriptors use `O_DIRECTORY | O_NOFOLLOW`.
21. Directory path and descriptor identity must match.
22. Worker umask is forced to `077`.
23. Worker identity includes process and cryptographic entropy.
24. Database pool concurrency is limited to three connections.
25. Database keepalive is disabled.
26. Database connection timeout is ten seconds.
27. Database and driver time handling is UTC.
28. Every acquired connection verifies `DATABASE()` and connection identity.
29. Maximum processing attempts equal three.
30. Expired queued and processing jobs become `expired` before claiming.
31. Stale claims at maximum attempts become `failed`.
32. Stale claims below maximum attempts return to `queued`.
33. Queue claims bind export, request, and Master Customer identity.
34. Only approved or completed requests are claimable.
35. Only access and export requests are claimable.
36. Queue claiming uses `SERIALIZABLE` isolation.
37. Claim candidates are locked before transition.
38. Every claim transition requires exactly one affected row.
39. Export collection uses a repeatable-read snapshot.
40. Request-to-export customer mismatches are rejected.
41. Archived Master Customers are rejected.
42. Each exported section is limited to 10,000 rows.
43. A complete export is limited to 50,000 rows.
44. The Master Customer query must return exactly one row.
45. Every exported table query is scoped to the selected customer.
46. Document metadata is exported without document binary content or storage keys.
47. Spreadsheet formula injection is neutralized in CSV cells.
48. CSV uses LF line endings and a final newline.
49. JSON keys are canonicalized and output ends with a newline.
50. Binary values are prohibited from text export payloads.
51. Request and section path segments are sanitized and digest-bound.
52. Temporary output directories include cryptographic entropy.
53. Existing final artifact targets are never intentionally overwritten.
54. Files use exclusive `O_EXCL | O_NOFOLLOW` creation.
55. Files require mode `0600`, one link, canonical identity, and matching owner.
56. Individual files are limited to 16 MiB.
57. Complete artifacts are limited to 32 files and 64 MiB.
58. The manifest records filename, section, row count, byte count, and SHA-256 for every data file.
59. Ready-state publication is bound to worker identity, request state, request type, expiry, and canonical schema columns.
60. Failure details are reduced to bounded error codes; expired, retryable, and terminal outcomes remain distinct.

## Queue authorization

Endpoint:

```text
POST /api/os2/privacy/requests/:id/export
```

Required permission:

```text
privacy.export
```

Queueing requires:

- a valid request ID;
- exact format `json` or `csv_bundle`;
- request type `access` or `export`;
- request status `approved` or `completed`;
- no active queued, processing, or ready export for the same request;
- a seven-day expiry;
- a transactional access-log event and central audit event.

The route uses `SERIALIZABLE` isolation. It does not generate files.

## Worker claim lifecycle

The worker first expires jobs whose expiry has passed. It then handles stale processing claims:

```text
attempts >= 3    -> failed
attempts < 3     -> queued
```

Only eligible, unexpired rows are locked and claimed. Each claim increments attempts and records the exact worker ID and claim time.

## Snapshot and data scope

The worker opens a repeatable-read transaction and revalidates:

- export status and worker identity;
- request and export customer agreement;
- approved/completed request status;
- access/export request type;
- JSON or CSV-bundle format;
- unexpired export;
- non-archived Master Customer.

The snapshot includes customer, accounts, contacts, mobile lines, fixed accounts, fixed services, representatives, consents, work items, restrictions, document metadata, service history, and customer-scoped audit history.

Document binary content and private storage keys are never copied into the export.

## Artifact publication

Every export is assembled in a randomized private temporary directory. Files are written with exclusive creation, flushed, reopened with `O_NOFOLLOW`, and checked for owner, permissions, one-link identity, byte count, and SHA-256 continuity.

JSON exports contain:

```text
customer-data.json
manifest.json
```

CSV bundles contain one canonical CSV file per section plus `manifest.json`.

The manifest is canonical JSON and records all data-file digests. The database `content_sha256` value is the SHA-256 of the exact manifest bytes. The database uses the existing canonical columns:

```text
storage_reference
content_sha256
row_count
file_count
total_bytes
generated_at
```

The worker does not use nonexistent `storage_path` or `sha256_checksum` columns.

## Metadata and revocation

Metadata endpoint:

```text
GET /api/os2/privacy/exports/:id
```

The response intentionally excludes `storage_reference`, so the private server path is not exposed to the browser. Metadata views are recorded in `os2_export_access_log`.

Revocation endpoint:

```text
POST /api/os2/privacy/exports/:id/revoke
```

Required permission:

```text
privacy.decide
```

Revocation requires a reason, locks the export, moves it to `revoked`, clears any active worker claim, writes access evidence, and writes central audit evidence. The worker cannot mark a revoked export ready; any newly generated output is removed when the guarded ready-state update fails.

Revocation does not silently delete existing artifacts. Deletion requires a separately approved maintenance process.

## Controlled activation sequence

1. Confirm the exact controlled branch and intended commit.
2. Complete dependency-lock generation and controlled two-file adoption.
3. Require the dependency-lock adoption workflow and normal preview CI to pass.
4. Generate and verify a preview database backup.
5. Complete the isolated restore test.
6. Apply all approved preview migrations through the governed migration process.
7. Verify schema and preview data.
8. Create and verify the private export directory.
9. Run the complete `npm run check` suite.
10. Run `npm ci --ignore-scripts --no-audit --no-fund` from the committed lock when preparing the runtime.
11. Start one preview worker with `npm run start:privacy-export-worker`.
12. Queue one approved JSON export and one approved CSV-bundle export.
13. Verify artifacts, metadata, checksums, customer isolation, expiry, failure handling, and revocation.
14. Record evidence in GitHub Issue #83.

Do not start multiple worker processes until single-worker preview testing passes.

## Verification evidence

Require evidence that:

- status moves `queued -> processing -> ready`;
- request, export, and Master Customer IDs agree;
- another customer's information is absent;
- `row_count`, `file_count`, `total_bytes`, `generated_at`, and `content_sha256` are populated;
- private files use `0600` and directories use `0700`;
- the manifest digest equals `content_sha256`;
- CSV formula-like values are neutralized;
- document binary content and storage keys are absent;
- metadata responses omit `storage_reference`;
- revocation clears an active claim and blocks ready publication;
- retryable failures process only the newly claimed attempt;
- the worker never connects to a non-preview database.

## Incident handling

Stop the worker when:

- the database or branch identity differs;
- the private directory fails ownership or mode checks;
- an export appears under a public path;
- another customer's data appears;
- a manifest or file digest differs;
- request approval is missing;
- repeated stale claims occur;
- output limits are exceeded;
- a revoked export becomes available;
- raw private data appears in a failure reason or log.

Preserve database events, access logs, central audit records, and private artifact evidence. Move affected artifacts only through a reviewed quarantine process.

## Execution boundary

`privacy-export-worker-check.js` contains exactly 60 named source and pure-function controls, with supporting checks for migration columns, route behavior, package wiring, and runbook coverage.

Normal validation syntax-checks the worker and executes source governance. It does not start the worker, connect to MySQL, claim jobs, generate files, revoke exports, run migrations, deploy preview, restart preview, or perform UAT.
