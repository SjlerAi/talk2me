# Controlled Multer 2 Upgrade Runbook

Status: planned, not executed
Related issue: #85
Preview version: 0.60.0

## Purpose

Migrate the OS2 preview from the reviewed Multer 1.4.5 LTS line to Multer 2.x without weakening upload authentication, authorization, limits, private-storage controls, cleanup behavior or error handling.

This runbook does not authorize dependency installation, deployment, migration execution, service restart or production mutation.

## Current upload inventory

### Customer documents

Source: `document-routes.js`

- Route: `POST /api/os2/customers/:id/documents`
- Authentication and `document.upload` permission execute before multipart parsing.
- Memory storage is used.
- Maximum file size is 10 MiB.
- Maximum file count is one.
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
- Accepted filename extensions are CSV, XLSX and XLS.
- Empty workbooks are rejected.
- Import files are limited to 10,000 rows.
- Preview state is bound to the authenticated owner and expires from memory.

### Staff documents

Source: `administration-routes.js`

- Route: `POST /api/administration/staff/:id/document`
- Authentication and manager authorization execute before multipart parsing.
- Disk storage uses generated random filenames rather than client filenames.
- Maximum file size is 8 MiB.
- Accepted MIME types are PDF, JPEG, PNG and WebP.
- Failed database persistence removes the uploaded file.

## Required pre-upgrade corrections

Before changing the Multer dependency:

1. Reject multiple files explicitly on every single-file route.
2. Set bounded multipart field and part counts where supported.
3. Ensure every validation failure after disk publication removes the temporary file.
4. Return controlled upload errors without absolute paths or raw Multer internals.
5. Confirm unsupported files are not retained.
6. Confirm malformed and truncated multipart requests fail closed.
7. Confirm authorization middleware remains before Multer middleware.

## Upgrade procedure

1. Work only on the controlled preview branch.
2. Record the exact Multer 2.x version selected for review.
3. Regenerate the dependency lock through the controlled generation workflow.
4. Review artifact checksum, provenance and source-inventory continuity.
5. Adopt the lock only through the controlled two-file adoption process.
6. Run syntax, governance and focused upload regression checks.
7. Run preview-only authenticated upload tests after explicit activation approval.
8. Perform browser and mobile UAT for customer documents, staff documents and monthly import preview.

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
