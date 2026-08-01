# Talk2Me OS2 Preview CI and Build Evidence Runbook

## Purpose

This runbook governs automated validation for the integrated Talk2Me OS2 preview rebuild. It does not deploy the application and it must never modify production.

## Workflow scope

The workflow `.github/workflows/os2-preview-ci.yml` runs when relevant preview application, preview public UI, or workflow files change. It can also be started manually from GitHub Actions.

The workflow performs the following controlled steps:

1. Check out the exact commit being tested.
2. Install Node.js 20.
3. Detect whether `os2-preview/package-lock.json` is committed.
4. Run `npm run verify:workspace-source-integrity` before dependency installation, using the fixed preview application root, database identity, controlled branch and disabled production/merge flags.
5. Install preview dependencies without lifecycle scripts and without creating a lockfile.
6. Run the complete `npm run check` validation suite.
7. Run the high-severity production-dependency audit only when the committed lockfile exists.
8. Record a visible dependency-audit blocker when the lockfile is absent.
9. Generate build evidence that independently reruns the deterministic source-integrity verifier and binds the resulting inventory digest into the build-evidence document.
10. Upload the complete evidence directory as a retained GitHub Actions artifact.

## Security controls

- Workflow permissions are read-only for repository content.
- `pull_request_target` is prohibited.
- Validation failures are not ignored.
- No database credentials, SMTP credentials or server secrets are required.
- The fixed `DB_NAME=kloka_talk2me` value is used only as a source-verifier identity guard; CI does not connect to MySQL.
- No migration, backup, export worker or application deployment command is executed.
- The workflow does not connect to the preview or production database.
- CI must not generate an uncommitted `package-lock.json`.
- Source-integrity verification must run before dependency installation.
- Build evidence must be generated only after the integrated validation suite completes.
- Dependency audit and release-candidate eligibility must not be claimed while the lockfile is absent.
- `ALLOW_PRODUCTION_MUTATION=false` and `ENABLE_CUSTOMER_MERGE_EXECUTION=false` are forced for source-integrity evidence generation.

## Dependency-lock policy

The current preview package has no committed `package-lock.json`.

Until dependency locking is completed, CI uses:

```bash
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
```

This allows source validation to continue without silently changing the repository dependency state.

When the lockfile is absent:

- `npm run verify:workspace-source-integrity` and `npm run check` may still run;
- dependency audit is blocked rather than reported as passed;
- the GitHub workflow summary records the blocker;
- build evidence records `dependencyLockPresent: false`;
- build evidence records `dependencyAuditEligible: false`;
- build evidence records `releaseCandidateEligible: false`;
- source integrity records `packageLockPresent: false`;
- release-candidate freeze remains prohibited.

When dependency locking is completed:

1. Generate the lockfile using the supported Node.js 20 and npm environment.
2. Review dependency versions and integrity metadata.
3. Run the high-severity production dependency audit.
4. Commit `os2-preview/package-lock.json` on the rebuild branch.
5. Replace the temporary install command with `npm ci --ignore-scripts --no-audit --no-fund`.
6. Enable npm caching against the committed lockfile.
7. Re-run the exact-commit CI workflow and retain its artifact.

The release-candidate gate must continue to fail when the committed lockfile is missing.

## Deterministic source-integrity evidence

Before dependency installation, CI runs:

```bash
npm run verify:workspace-source-integrity
```

The verifier securely reads the protected source set with `O_NOFOLLOW`, canonical path validation, pathname/descriptor device and inode binding, hard-link rejection, ownership checks, permission checks and bounded reads.

It creates a deterministic inventory from the sorted tuple:

```text
relative filename + byte length + SHA-256
```

The final `inventorySha256` represents the complete protected source state. A different digest means the evidence belongs to a different source state.

The verifier is run again by `build-evidence.js`. The build-evidence command fails closed when the verifier cannot start, is interrupted, returns a non-zero result, produces invalid JSON or omits a valid 64-character inventory digest.

## Build evidence

The command `npm run evidence:build` creates:

- `build-evidence/build-evidence.json`
- `build-evidence/build-evidence.sha256`
- `build-evidence/workspace-source-integrity.json`
- `build-evidence/workspace-source-integrity.sha256`

The evidence records:

- application version;
- commit SHA and branch when run in GitHub Actions;
- workflow run identifiers;
- Node.js and operating-system information;
- dependency-lock presence;
- dependency-audit eligibility;
- release-candidate eligibility;
- `workspaceSourceIntegrityVerified: true`;
- the deterministic `workspaceSourceInventorySha256`;
- protected-source and migration counts from the source verifier;
- the complete source-integrity inventory;
- a SHA-256 checksum for each relevant source file;
- migration count;
- route-file count;
- validation-check count;
- checksums for both evidence documents.

The generated evidence directory is disposable build output and is not a deployment package.

## Acceptance rule

A commit may proceed to controlled preview installation only when all of the following are true:

1. The OS2 Preview CI workflow completes successfully for the exact commit.
2. The pre-install source-integrity step succeeds and reports the same protected source state subsequently retained in build evidence.
3. A committed lockfile exists and the dependency audit has no unresolved high or critical production vulnerabilities.
4. Both evidence JSON files exist and their SHA-256 sidecars match.
5. Build evidence records `workspaceSourceIntegrityVerified: true` and a valid 64-character `workspaceSourceInventorySha256`.
6. The evidence records `dependencyLockPresent: true`, `dependencyAuditEligible: true` and `releaseCandidateEligible: true`.
7. Preview deployment readiness, migration, schema verification, pinned restore-evidence verification and UAT controls are followed separately.

A successful source-validation step without a dependency lock is not a dependency-audit pass and is not release-candidate approval.

## Failure handling

When CI fails or reports a blocker:

1. Open the workflow run and identify the first failing validation or recorded blocker.
2. Compare the source-integrity inventory digest with the expected exact-commit evidence.
3. Do not bypass or weaken the check.
4. Correct the code, dependency state or validation contract on the rebuild branch.
5. Re-run the workflow on the corrected exact commit.
6. Retain the failed or blocked run as historical evidence.

## Production protection

This workflow contains no deployment credentials and no production commands. Production at `talk2me.uent.co.za` remains outside this workflow and must not be changed by preview validation activity.
