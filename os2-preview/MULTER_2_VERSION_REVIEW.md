# Multer 2 Version Review

Status: target selected, dependency change not executed
Related issue: #85
Preview version: 0.60.0
Review date: 2026-08-02

## Selected review target

- Package: `multer`
- Exact target version: `2.2.0`
- Release channel: stable `latest`
- Pre-release versions are prohibited for this upgrade.
- `3.0.0-alpha.2` is explicitly excluded.

## Source basis

The npm package registry identified Multer `2.2.0` as the current stable `latest` release on the review date. The package documentation continues to recommend bounded file-size, file-count and field-count limits and controlled Express error handling.

This repository record does not authorize dependency installation, lock generation, lock adoption, deployment, restart, preview activation or production mutation.

## Current and target state

- Current reviewed dependency: `^1.4.5-lts.1`
- Selected review target: exact `2.2.0`
- Active dependency changed: no
- Package lock changed: no
- Dependency installation executed: no
- Preview runtime changed: no
- Production changed: no

## Compatibility assumptions to verify

The existing three upload surfaces must retain:

1. authentication and authorization before multipart parsing;
2. one-file ceilings;
3. existing file-size ceilings;
4. bounded field and part counts;
5. current MIME and extension allowlists;
6. private storage boundaries and file modes;
7. exclusive customer-document publication;
8. cleanup after validation and persistence failures;
9. controlled JSON errors without filesystem paths or stack traces;
10. fail-closed malformed and truncated request handling.

No assumption is accepted merely because the public Multer API appears similar. The isolated regression suite must be executed against the selected version through the controlled dependency process.

## Controlled next gate

Before changing `package.json`:

1. obtain explicit approval to generate dependency evidence for exact Multer `2.2.0`;
2. use the controlled dependency-lock generation workflow;
3. verify artifact checksums, provenance and source continuity;
4. adopt `package.json` and `package-lock.json` only through the controlled two-file adoption process;
5. run the complete source and isolated upload regression suite;
6. review every intentional error-code or strict-boundary difference;
7. run preview-only authenticated upload tests and browser/mobile UAT after activation approval.

## Rejection conditions

Reject or roll back the candidate if:

- a current upload limit disappears or weakens;
- authorization moves after Multer middleware;
- rejected disk uploads remain;
- customer documents enter a public web root;
- controlled errors expose internal paths, stacks or parser internals;
- malformed or truncated requests no longer fail closed;
- dependency provenance or lock verification fails;
- any production operation is required before preview evidence is complete.
