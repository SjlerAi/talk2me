# Controlled Multer 2 Upgrade Runbook

Status: target selected, dependency change not executed
Related issue: #85
Preview version: 0.60.0
Selected review target: exact Multer 2.2.0
Version review: `MULTER_2_VERSION_REVIEW.md`
Generation approval: `MULTER_2_GENERATION_APPROVAL.md` — status `not approved`
Candidate manifest plan: `MULTER_2_CANDIDATE_MANIFEST_PLAN.md` — planned, not authorized, not applied
Candidate evidence schema: `MULTER_2_CANDIDATE_EVIDENCE_SCHEMA.md` — schema version `1`, no evidence emitted

## Purpose

Migrate the OS2 preview from the reviewed Multer 1.4.5 LTS line to exact Multer 2.2.0 without weakening upload authentication, authorization, limits, private-storage controls, cleanup behavior or error handling.

Multer 3 pre-release versions are excluded. This runbook does not authorize dependency installation, deployment, migration execution, service restart or production mutation.

## Current upload inventory

### Customer documents

Source: `document-routes.js`

- Route: `POST /api/os2/customers/:id/documents`
- Authentication and `document.upload` permission execute before multipart parsing.
- Memory storage is used.
- Maximum file size is 10 MiB.
- Maximum file count is one.
- Maximum field count is four and maximum part count is five.
- Accepted MIME types are PDF, JPEG, PNG and WebP.
- Persistent files are written beneath `OS2_PRIVATE_DOCUMENT_ROOT` or the private default root.
- Resolved paths must remain beneath the private root.
- Directories use mode `0700` and files use mode `0600`.
- Publication uses exclusive creation with `flag: 'wx'`.
- A database or transaction failure removes the newly written file.

### Monthly import preview

Source: `import-routes.js`

- Route: `POST /api/imports/preview`
- Authentication and owner authorization execute before multipart parsing.
- Memory storage is used.
- Maximum file size is 12 MiB.
- Maximum file count is one.
- Maximum field count is eight and maximum part count is nine.
- Accepted filename extensions are CSV, XLSX and XLS.
- Empty workbooks are rejected.
- Import files are limited to 10,000 rows.
- Preview state is bound to the authenticated owner and expires from memory.

### Staff documents

Source: `administration-routes.js`

- Route: `POST /api/administration/staff/:id/document`
- Authentication and manager authorization execute before multipart parsing.
- Disk storage uses generated random filenames rather than client filenames.
- The upload directory is created with mode `0700`.
- Maximum file size is 8 MiB.
- Maximum file count is one.
- Maximum field count is four and maximum part count is five.
- Accepted MIME types are PDF, JPEG, PNG and WebP.
- Validation failure after disk publication removes the uploaded file.
- Failed database persistence removes the uploaded file.

## Completed isolated request regressions

Source: `multer-request-regression-check.js`

The normal security-validation chain runs a temporary HTTP server bound only to `127.0.0.1` on an ephemeral port. It configures no database and uses memory storage only.

The fixture verifies:

- one valid single-file request;
- a missing file remains visible to route-level validation;
- an empty multipart request remains visible to route-level validation;
- multiple files fail closed;
- a wrong file field fails closed;
- strict file-size boundary behavior is recorded;
- excessive and duplicate fields are covered;
- excessive parts fail closed;
- unsupported MIME types fail closed;
- wrong, missing and truncated multipart boundaries fail closed;
- controlled JSON errors expose no private paths, stack traces or raw parser internals;
- responses and evidence are bounded;
- no persistent upload storage or production mutation is used.

The fixture is a source-validation regression, not preview UAT and not evidence that deployed upload routes have been exercised.

## Required pre-upgrade controls

Before changing the Multer dependency:

1. Keep multiple-file rejection explicit on every single-file route.
2. Keep bounded multipart field and part counts.
3. Ensure every validation failure after disk publication removes the temporary file.
4. Return controlled upload errors without absolute paths or raw Multer internals.
5. Confirm unsupported files are not retained.
6. Confirm malformed and truncated multipart requests fail closed.
7. Confirm authorization middleware remains before Multer middleware.
8. Keep exact target `2.2.0`; no range and no pre-release substitution.
9. Keep `MULTER_2_GENERATION_APPROVAL.md` at `Status: not approved` until the owner supplies the exact approval phrase.
10. Treat generation approval, dependency adoption, preview activation and production activation as separate gates.
11. Require the candidate manifest to change exactly one value: Multer from `^1.4.5-lts.1` to exact `2.2.0`.
12. Preserve the scripts object and every non-Multer dependency exactly.
13. Require candidate evidence schema version `1` with exactly 28 top-level keys.
14. Bind source manifest, candidate manifest, candidate lock and protected source inventory with SHA-256 digests.
15. Require constant-time digest comparison, approval freshness within 24 hours and completed rollback evidence when rollback is required.
16. Prohibit credentials, environment dumps, private paths, sessions, cookies, authorization headers and database values from candidate evidence.

Items 1 through 7 are enforced in committed source-level validation. Item 8 is governed by `MULTER_2_VERSION_REVIEW.md` and `multer-upgrade-governance-check.js`. Items 9 and 10 are governed by `MULTER_2_GENERATION_APPROVAL.md` and `multer-generation-approval-check.js`. Items 11 and 12 are governed by `MULTER_2_CANDIDATE_MANIFEST_PLAN.md` and `multer-candidate-manifest-plan-check.js`. Items 13 through 16 are governed by `MULTER_2_CANDIDATE_EVIDENCE_SCHEMA.md` and `multer-candidate-evidence-schema-check.js`. Deployed-route regression and preview UAT remain required after controlled dependency adoption.

## Upgrade procedure

1. Work only on the controlled preview branch.
2. Use exact Multer `2.2.0` as the reviewed candidate.
3. Obtain the exact owner approval phrase recorded in `MULTER_2_GENERATION_APPROVAL.md` before dependency evidence generation.
4. Record the approved 40-character source commit, canonical UTC timestamp and approving owner identity.
5. Create the candidate manifest only in a private temporary workspace according to `MULTER_2_CANDIDATE_MANIFEST_PLAN.md`.
6. Emit candidate evidence only in the exact schema defined by `MULTER_2_CANDIDATE_EVIDENCE_SCHEMA.md`.
7. Regenerate the dependency lock through the controlled generation workflow.
8. Review artifact checksum, provenance and source-inventory continuity.
9. Adopt `package.json` and `package-lock.json` only through the controlled two-file adoption process.
10. Run syntax, governance and focused upload regression checks.
11. Review all error-code and size-boundary differences against the recorded 1.x baseline.
12. Run preview-only authenticated upload tests after explicit activation approval.
13. Perform browser and mobile UAT for customer documents, staff documents and monthly import preview.

## Regression matrix

Each upload surface must test:

- missing file;
- one valid file;
- multiple files;
- oversized file;
- unsupported MIME type;
- misleading extension;
- duplicate multipart field;
- excessive field count;
- malformed boundary;
- truncated body;
- unauthenticated request;
- authenticated but unauthorized request;
- database failure after parsing;
- cleanup after rejection;
- response body free of private paths and stack traces.

## Acceptance gates

The upgrade is accepted only when:

- exact Multer `2.2.0` and its controlled lock provenance are verified;
- the exact generation approval record is complete for the approved source commit;
- the candidate manifest differs from the active manifest only by the exact Multer value;
- candidate evidence uses schema version `1` and exactly 28 top-level keys;
- all four required SHA-256 bindings verify independently with constant-time comparison;
- generation occurs no more than 24 hours after approval;
- rollback completion is proven when rollback is required;
- candidate evidence contains no prohibited secret or private operational data;
- dependency adoption remains separately approved and provenance-bound;
- all current size and file-count limits remain enforced;
- authorization still executes before multipart parsing;
- no rejected upload remains on disk;
- customer documents remain outside the public web root;
- exclusive private publication remains enforced;
- controlled errors do not expose internal filesystem paths;
- dependency-lock generation, artifact verification, provenance verification and adoption governance pass;
- the complete committed-source suite passes;
- focused preview upload regression tests pass;
- production remains untouched until explicit owner approval.
