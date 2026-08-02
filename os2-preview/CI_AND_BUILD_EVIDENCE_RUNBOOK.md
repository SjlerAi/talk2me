# Talk2Me OS2 Preview CI and Build Evidence Runbook

## Purpose

This runbook governs automated validation for the integrated Talk2Me OS2 preview rebuild. It does not deploy the application and it must never modify production.

## Controlled branch only

Release-grade build evidence is produced only from the controlled rebuild branch:

```text
agent/talk2me-os2-integrated-rebuild
```

The workflow accepts only:

- a push to the controlled branch;
- a manual `workflow_dispatch` started against the controlled branch.

`pull_request` and `pull_request_target` events are prohibited for this release-evidence workflow. Pull-request merge refs such as `refs/pull/<number>/merge` do not represent the exact controlled branch identity expected by release evidence and therefore must not generate releasable evidence.

Before dependency verification, the workflow verifies:

```text
GITHUB_REPOSITORY=SjlerAi/talk2me
GITHUB_REF=refs/heads/agent/talk2me-os2-integrated-rebuild
GITHUB_REF_NAME=agent/talk2me-os2-integrated-rebuild
GITHUB_EVENT_NAME=push or workflow_dispatch
GITHUB_SHA is present
```

A different repository, event, branch, ref, or missing commit SHA stops the workflow before dependency installation or evidence generation.

## Controlled workflow sequence

1. Check out the exact controlled-branch commit with credentials persistence disabled and `fetch-depth: 1`.
2. Install Node.js 20.
3. Verify the allowed event, repository, branch, ref, and commit identity.
4. Run `node dependency-lock-verification.js`.
5. Run `node dependency-lock-governance-check.js`.
6. Run `npm run --silent verify:workspace-source-integrity` before dependency installation.
7. Require `packageLockPresent: true` and retain the pre-install inventory digest.
8. Install only with `npm ci --ignore-scripts --no-audit --no-fund`.
9. Run `npm run check`.
10. Run `npm audit --omit=dev --audit-level=high` without conditional bypass.
11. Generate build evidence after validation and audit.
12. Compare the pre-install inventory digest and post-install inventory digest; they must match exactly.
13. Publish evidence atomically into a private directory and reverify every checksum pair.
14. Upload the complete evidence directory as a retained artifact whose name includes the run number and run attempt.

A missing lockfile is a hard failure. CI must not continue with `npm install`, `--package-lock=false`, a warning-only step, a conditional dependency audit, or any other substitute for the committed reviewed lock.

## Dependency lock verification

`dependency-lock-verification.js` is a read-only source verifier. It requires:

- application `talk2me-os2-preview` version `0.59.0`;
- preview root and database identity;
- controlled branch identity;
- Node.js 20;
- production mutation disabled;
- customer-merge execution disabled;
- canonical private source paths;
- regular single-link `package.json` and `package-lock.json` files;
- safe owner and write permissions;
- descriptor identity and metadata stability;
- bounded reads;
- valid UTF-8 JSON with LF line endings and final newline;
- exact direct dependency set;
- no root development, optional, bundled, or workspace dependencies;
- `lockfileVersion` must be `3`;
- exact root dependency agreement between `package.json` and the lock;
- normalized `node_modules/` package paths;
- no linked, bundled, extraneous, development, or install-script packages;
- semantic package versions;
- `https://registry.npmjs.org/` tarball URLs only;
- SHA-512 integrity for every installed package;
- resolvable dependency graph edges;
- a lock entry for each direct dependency.

The verifier hashes both package files and records their SHA-256 values in its evidence. It never installs dependencies, changes files, creates directories, or writes a replacement lock.

`dependency-lock-governance-check.js` confirms that the verifier, CI workflow, activation preflight, source inventory, activation governance, and runbooks all enforce the same fail-closed policy.

## Immutable GitHub Action references

Every third-party GitHub Action must be pinned to one exact immutable 40-character commit SHA. Mutable action tags, branches, and `latest` references are prohibited.

The controlled workflow currently permits exactly these three action identities:

- `actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955` — reviewed release v4.3.0;
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` — reviewed release v4.4.0;
- `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` — reviewed release v4.6.2.

The workflow must contain exactly three `uses:` entries. `@v4`, `@main`, `@master`, `@latest`, tags, branches, shortened SHAs, and unreviewed additional actions are rejected.

Checkout uses:

```text
persist-credentials: false
fetch-depth: 1
```

The workflow does not require Git credentials after checkout and must not retain them in the runner workspace.

## Workflow security controls

- Repository permission is read-only.
- Validation failures cannot be ignored.
- CI does not connect to preview or production databases.
- CI does not run migrations, backups, restore tests, workers, deployment, or restart commands.
- `ALLOW_PRODUCTION_MUTATION=false` and `ENABLE_CUSTOMER_MERGE_EXECUTION=false` are forced.
- Dependency lock verification runs before source hashing and dependency installation.
- Source verification runs before dependency installation.
- Dependency installation uses the committed lock only.
- Install scripts are disabled.
- Dependency audit is mandatory.
- Build evidence runs only after integrated validation and audit.
- Build-evidence source verification has a 30-second timeout, forced `SIGKILL`, and shell execution disabled.
- Workflow provenance variables are passed explicitly to evidence generation.
- Artifact names include both workflow run number and workflow run attempt.

## Source-integrity continuity

The pre-install verifier output is retained in `$RUNNER_TEMP/os2-workspace-source-integrity-preinstall.json`. CI extracts the pre-install inventory digest after confirming `packageLockPresent: true`. `build-evidence.js` reruns the source verifier after dependency installation and validation.

A successful controlled CI artifact must record:

```text
workspaceSourceIntegrityStableAcrossDependencyInstall: true
dependencyLockPresent: true
dependencyAuditEligible: true
```

The pre-install inventory digest and post-install inventory digest must match exactly. A mismatch invalidates the evidence.

The workflow itself, dependency-lock verifier, dependency-lock governance check, package files, source-integrity controls, and build-evidence controls are part of the protected source inventory. Changes to any of them change the approved source digest.

## Secure bounded manifest collection

Broad source evidence is collected only through secure descriptor-based reads.

Directories must be canonical real directories opened with `O_DIRECTORY | O_NOFOLLOW`, retain device/inode identity, have the expected owner, and reject unsafe write permissions. Files must be regular single-link files opened with `O_NOFOLLOW`, retain device/inode and byte-count identity, have the expected owner, and reject unsafe write permissions.

Collection is fail-closed and bounded to:

- at most 2,000 files;
- at most 16 MiB per file;
- at most 256 MiB total source bytes.

Before deleting prior disposable output, an existing `build-evidence` path must be a real directory owned by the executing user.

## Atomic evidence publication

The command creates a private `0700` evidence directory. Every evidence file is written to an exclusively created temporary file with private `0600` permissions, flushed with `fsync`, and atomically renamed.

It reverifies:

- `build-evidence.json` with `build-evidence.sha256`;
- `workspace-source-integrity.json` with `workspace-source-integrity.sha256`;
- `artifact-manifest.json` with `artifact-manifest.sha256`.

All checksum pairs are reverified before upload.

## Acceptance rule

Controlled preview installation requires all of the following:

1. CI succeeds for the exact controlled-branch commit.
2. The workflow event is `push` or manual `workflow_dispatch` on the controlled branch.
3. Repository, branch, ref, workflow, commit, run, attempt, and actor provenance are valid.
4. Every action reference is one of the reviewed immutable 40-character SHA pins.
5. Checkout credentials are not persisted.
6. Dependency-lock verification succeeds.
7. Dependency-lock governance succeeds.
8. The pre-install source verifier succeeds and reports `packageLockPresent: true`.
9. Dependency installation uses `npm ci --ignore-scripts --no-audit --no-fund`.
10. The production dependency audit passes without unresolved high or critical findings.
11. Pre-install and post-install source digests match exactly.
12. `workspaceSourceIntegrityStableAcrossDependencyInstall: true` is present.
13. All evidence JSON files and sidecars verify.
14. Preview readiness, migration, schema verification, pinned restore-evidence verification, and UAT controls pass separately.

A successful source-governance check without an actual committed and verified lockfile is not dependency approval, CI approval, or release approval.

## Production protection

Production at `talk2me.uent.co.za` remains outside this workflow. The workflow has no production deployment authority and must not change production.
