# Talk2Me OS2 Preview CI and Build Evidence Runbook

## Purpose

This runbook governs automated validation for the integrated Talk2Me OS2 preview rebuild. It does not deploy the application and it must never modify production.

## Workflow scope

The workflow `.github/workflows/os2-preview-ci.yml` runs when relevant preview application, preview public UI, or workflow files change. It can also be started manually from GitHub Actions.

The workflow performs the following controlled steps:

1. Check out the exact commit being tested.
2. Install Node.js 20.
3. Detect whether `os2-preview/package-lock.json` is committed.
4. Install preview dependencies without lifecycle scripts and without creating a lockfile.
5. Run the complete `npm run check` validation suite.
6. Run the high-severity production-dependency audit only when the committed lockfile exists.
7. Record a visible dependency-audit blocker when the lockfile is absent.
8. Generate a build-evidence manifest that records dependency-lock eligibility.
9. Upload the evidence as a retained GitHub Actions artifact.

## Security controls

- Workflow permissions are read-only for repository content.
- `pull_request_target` is prohibited.
- Validation failures are not ignored.
- No database credentials, SMTP credentials or server secrets are required.
- No migration, backup, export worker or application deployment command is executed.
- The workflow does not connect to the preview or production database.
- CI must not generate an uncommitted `package-lock.json`.
- Dependency audit and release-candidate eligibility must not be claimed while the lockfile is absent.

## Dependency-lock policy

The current preview package has no committed `package-lock.json`.

Until dependency locking is completed, CI uses:

```bash
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
```

This allows source validation to continue without silently changing the repository dependency state.

When the lockfile is absent:

- `npm run check` may still run;
- dependency audit is blocked rather than reported as passed;
- the GitHub workflow summary records the blocker;
- build evidence records `dependencyLockPresent: false`;
- build evidence records `dependencyAuditEligible: false`;
- build evidence records `releaseCandidateEligible: false`;
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

## Build evidence

The command `npm run evidence:build` creates:

- `build-evidence/build-evidence.json`
- `build-evidence/build-evidence.sha256`

The evidence records:

- application version;
- commit SHA and branch when run in GitHub Actions;
- workflow run identifiers;
- Node.js and operating-system information;
- dependency-lock presence;
- dependency-audit eligibility;
- release-candidate eligibility;
- a SHA-256 checksum for each relevant source file;
- migration count;
- route-file count;
- validation-check count;
- a checksum for the evidence document itself.

The generated evidence directory is disposable build output and is not a deployment package.

## Acceptance rule

A commit may proceed to controlled preview installation only when all of the following are true:

1. The OS2 Preview CI workflow completes successfully for the exact commit.
2. A committed lockfile exists and the dependency audit has no unresolved high or critical production vulnerabilities.
3. The build-evidence artifact exists and its SHA-256 file matches the evidence JSON.
4. The evidence records `dependencyLockPresent: true`, `dependencyAuditEligible: true` and `releaseCandidateEligible: true`.
5. Preview deployment readiness, migration, schema verification, pinned restore-evidence verification and UAT controls are followed separately.

A successful source-validation step without a dependency lock is not a dependency-audit pass and is not release-candidate approval.

## Failure handling

When CI fails or reports a blocker:

1. Open the workflow run and identify the first failing validation or recorded blocker.
2. Do not bypass or weaken the check.
3. Correct the code, dependency state or validation contract on the rebuild branch.
4. Re-run the workflow on the corrected exact commit.
5. Retain the failed or blocked run as historical evidence.

## Production protection

This workflow contains no deployment credentials and no production commands. Production at `talk2me.uent.co.za` remains outside this workflow and must not be changed by preview validation activity.
