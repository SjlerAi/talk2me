# Talk2Me OS2 Preview CI and Build Evidence Runbook

## Purpose

This runbook governs automated validation for the integrated Talk2Me OS2 preview rebuild. It does not deploy the application and it must never modify production.

## Workflow scope

The workflow `.github/workflows/os2-preview-ci.yml` runs when relevant preview application, preview public UI, or workflow files change. It can also be started manually from GitHub Actions.

The workflow performs the following controlled steps:

1. Check out the exact commit being tested.
2. Install Node.js 20.
3. Detect whether `os2-preview/package-lock.json` is committed.
4. Run `npm run verify:workspace-source-integrity` before dependency installation and retain its JSON in the runner temporary directory.
5. Extract the pre-install inventory digest and package-lock state as protected workflow outputs.
6. Confirm dependency-lock detection agrees with the source-integrity evidence.
7. Install preview dependencies without lifecycle scripts and without creating or changing a lockfile.
8. Run the complete `npm run check` validation suite.
9. Run the high-severity production-dependency audit only when the committed lockfile exists.
10. Record a visible dependency-audit blocker when the lockfile is absent.
11. Generate build evidence that reruns the deterministic source-integrity verifier.
12. Compare the post-install inventory digest with the retained pre-install inventory digest using constant-time comparison.
13. Upload the complete evidence directory as a retained GitHub Actions artifact.

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
- The pre-install inventory digest and post-install inventory digest must match exactly.
- Dependency-lock detection must agree with both the filesystem and source-integrity evidence.
- Build evidence must be generated only after the integrated validation suite completes.
- Build-evidence source verification has a 30-second timeout, forced `SIGKILL` termination and shell execution disabled.
- Broad evidence collection rejects symbolic links, unsupported filesystem entries and files with additional hard links.
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

## Deterministic source-integrity continuity

Before dependency installation, CI runs:

```bash
npm run --silent verify:workspace-source-integrity
```

The verifier securely reads the protected source set with `O_NOFOLLOW`, canonical path validation, pathname/descriptor device and inode binding, hard-link rejection, ownership checks, permission checks and bounded reads.

It creates a deterministic inventory from the sorted tuple:

```text
relative filename + byte length + SHA-256
```

The final `inventorySha256` represents the complete protected source state. A different digest means the evidence belongs to a different source state.

The pre-install JSON is retained in `$RUNNER_TEMP/os2-workspace-source-integrity-preinstall.json`. CI extracts:

- `inventory_sha256`;
- `package_lock_present`.

The dependency-lock output from direct filesystem detection must match `package_lock_present` before dependency installation begins.

`build-evidence.js` reruns the verifier after dependency installation and integrated validation. In GitHub Actions, `EXPECTED_PREINSTALL_SOURCE_INVENTORY_SHA256` is mandatory. Evidence generation fails when:

- the expected digest is missing or malformed;
- the verifier cannot start, times out, is interrupted or fails;
- verifier output is invalid or incomplete;
- the post-install digest differs from the pre-install digest;
- source-integrity lock evidence differs from the filesystem;
- `DEPENDENCY_LOCK_PRESENT` differs from the filesystem;
- broad evidence traversal encounters a symbolic link, unsupported entry or multi-link file.

A successful CI artifact must record:

```text
workspaceSourceIntegrityStableAcrossDependencyInstall: true
```

This proves dependency installation and validation did not alter the protected source set.

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
- lock-state verification against the filesystem and source-integrity evidence;
- `workspaceSourceIntegrityVerified: true`;
- the pre-install and post-install protected source inventory digests;
- `workspaceSourceIntegrityStableAcrossDependencyInstall: true` in controlled CI;
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
2. The pre-install source-integrity step succeeds.
3. Dependency-lock detection matches source-integrity lock evidence.
4. The pre-install and post-install source inventory digests match exactly.
5. Build evidence records `workspaceSourceIntegrityStableAcrossDependencyInstall: true`.
6. A committed lockfile exists and the dependency audit has no unresolved high or critical production vulnerabilities.
7. Both evidence JSON files exist and their SHA-256 sidecars match.
8. Build evidence records `workspaceSourceIntegrityVerified: true` and a valid 64-character `workspaceSourceInventorySha256`.
9. The evidence records `dependencyLockPresent: true`, `dependencyAuditEligible: true` and `releaseCandidateEligible: true`.
10. Preview deployment readiness, migration, schema verification, pinned restore-evidence verification and UAT controls are followed separately.

A successful source-validation step without a dependency lock is not a dependency-audit pass and is not release-candidate approval.

## Failure handling

When CI fails or reports a blocker:

1. Open the workflow run and identify the first failing validation or recorded blocker.
2. Compare the pre-install and post-install source-integrity inventory digests.
3. Compare dependency-lock detection with filesystem and source-integrity evidence.
4. Do not bypass or weaken the check.
5. Correct the code, dependency state or validation contract on the rebuild branch.
6. Re-run the workflow on the corrected exact commit.
7. Retain the failed or blocked run as historical evidence.

## Production protection

This workflow contains no deployment credentials and no production commands. Production at `talk2me.uent.co.za` remains outside this workflow and must not be changed by preview validation activity.
