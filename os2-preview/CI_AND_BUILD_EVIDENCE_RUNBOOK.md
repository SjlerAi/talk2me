# Talk2Me OS2 Preview CI and Build Evidence Runbook

## Purpose

This runbook governs automated validation for the integrated Talk2Me OS2 preview rebuild. It does not deploy the application and it must never modify production.

## Workflow scope

The workflow `.github/workflows/os2-preview-ci.yml` runs when relevant preview application, preview public UI, or workflow files change. It can also be started manually from GitHub Actions.

The workflow performs the following controlled steps:

1. Check out the exact commit being tested.
2. Install Node.js 20.
3. Install preview dependencies without running package lifecycle scripts.
4. Run the complete `npm run check` validation suite.
5. Run a high-severity production-dependency audit.
6. Generate a deterministic build-evidence manifest.
7. Upload the evidence as a retained GitHub Actions artifact.

## Security controls

- Workflow permissions are read-only for repository content.
- `pull_request_target` is prohibited.
- Validation failures are not ignored.
- No database credentials, SMTP credentials or server secrets are required.
- No migration, backup, export worker or application deployment command is executed.
- The workflow does not connect to the preview or production database.

## Build evidence

The command `npm run evidence:build` creates:

- `build-evidence/build-evidence.json`
- `build-evidence/build-evidence.sha256`

The evidence records:

- application version;
- commit SHA and branch when run in GitHub Actions;
- workflow run identifiers;
- Node.js and operating-system information;
- a SHA-256 checksum for each relevant source file;
- migration count;
- route-file count;
- validation-check count;
- a checksum for the evidence document itself.

The generated evidence directory is disposable build output and is not a deployment package.

## Acceptance rule

A commit may proceed to controlled preview installation only when all of the following are true:

1. The OS2 Preview CI workflow completes successfully for the exact commit.
2. The dependency audit has no unresolved high or critical production vulnerabilities.
3. The build-evidence artifact exists and its SHA-256 file matches the evidence JSON.
4. Preview deployment readiness, migration, schema verification and UAT controls are still followed separately.

A successful CI workflow alone does not mean the rebuild is deployable, accepted or production-ready.

## Failure handling

When CI fails:

1. Open the failed job and identify the first failing validation step.
2. Do not bypass or weaken the check.
3. Correct the code or validation contract on the rebuild branch.
4. Re-run the workflow on the corrected commit.
5. Retain the failed run as historical evidence.

## Dependency lock status

The preview package currently has no committed `package-lock.json`. The workflow therefore uses `npm install` rather than `npm ci`. Before a release candidate is frozen, generate and review a lock file with the supported Node.js and npm versions, commit it, and change the workflow to `npm ci`.

## Production protection

This workflow contains no deployment credentials and no production commands. Production at `talk2me.uent.co.za` remains outside this workflow and must not be changed by preview validation activity.
