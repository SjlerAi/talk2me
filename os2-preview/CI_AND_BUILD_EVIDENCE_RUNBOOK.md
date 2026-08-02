# Talk2Me OS2 Preview CI and Build Evidence Runbook

## Purpose

This runbook governs automated validation for the integrated Talk2Me OS2 preview rebuild. It does not deploy the application and it must never modify production.

## Controlled branch only

This release-evidence policy is controlled branch only.

Release-grade build evidence is produced only from:

```text
agent/talk2me-os2-integrated-rebuild
```

Normal preview CI accepts a push and manual `workflow_dispatch` on the controlled branch. `pull_request` and `pull_request_target` events are prohibited for release evidence. pull_request merge refs do not prove the exact controlled branch identity.

Before dependency verification, the workflow requires:

```text
GITHUB_REPOSITORY=SjlerAi/talk2me
GITHUB_REF=refs/heads/agent/talk2me-os2-integrated-rebuild
GITHUB_REF_NAME=agent/talk2me-os2-integrated-rebuild
GITHUB_EVENT_NAME=push or workflow_dispatch
GITHUB_SHA is present
```

## Normal preview CI sequence

1. Check out the exact commit with `persist-credentials: false` and `fetch-depth: 1`.
2. Install Node.js 20.
3. Verify repository, event, branch, ref, and commit identity.
4. Run `node dependency-lock-verification.js`.
5. Run `node dependency-lock-governance-check.js`.
6. Capture the pre-install inventory digest.
7. Require `packageLockPresent: true`.
8. Install with `npm ci --ignore-scripts --no-audit --no-fund`.
9. Run `npm run check`.
10. Run `npm audit --omit=dev --audit-level=high`.
11. Generate build evidence.
12. Require the pre-install inventory digest and post-install inventory digest to match exactly.
13. Publish evidence through atomic publication into a private directory.
14. Upload the evidence artifact with run number and attempt in its name.

A missing lockfile is a hard failure. `npm install`, `--package-lock=false`, conditional audit, warning-only lock checks, and lock bypasses are prohibited.

## Dependency lock verification

`dependency-lock-verification.js` requires:

- application `talk2me-os2-preview` version `0.59.0`;
- exact preview root, database, and branch identity;
- Node.js 20;
- production mutation and customer-merge execution disabled;
- canonical regular single-link package files;
- owner consistency and safe permissions;
- secure descriptor-based reads using `O_NOFOLLOW`;
- descriptor identity and metadata stability;
- bounded reads and exact byte counts;
- fatal UTF-8, LF line endings, and final newline;
- exact direct dependencies;
- no root development, optional, bundled, or workspace dependencies;
- lockfile version 3;
- normalized `node_modules/` paths;
- no linked, bundled, extraneous, development, or install-script packages;
- registry HTTPS URLs and SHA-512 integrity;
- resolved dependency graph edges.

The verifier is read-only. `dependency-lock-governance-check.js` confirms the same fail-closed policy across CI, activation, source inventory, and runbooks.

## Immutable GitHub Actions

Every GitHub Action reference is pinned to an immutable 40-character commit SHA:

- `actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955`;
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`;
- `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`.

Mutable action tags, branches, and `latest` references are prohibited. The normal CI workflow contains exactly three action uses.

## Source-integrity continuity

The workflow stores pre-install evidence in `$RUNNER_TEMP/os2-workspace-source-integrity-preinstall.json`. `build-evidence.js` reruns source verification after dependency installation and validation.

Successful evidence records:

```text
workspaceSourceIntegrityStableAcrossDependencyInstall: true
dependencyLockPresent: true
dependencyAuditEligible: true
```

The pre-install inventory digest and post-install inventory digest must match exactly.

The normal CI workflow, dependency-lock generation workflow, dependency-lock adoption workflow, package files, provenance when present, source controls, governance controls, and build-evidence controls are part of the protected source inventory.

## OS2 Dependency Lock Adoption

The adoption workflow is:

```text
.github/workflows/os2-dependency-lock-adoption.yml
```

It runs only on the controlled branch, uses read-only repository permission, and is triggered by the exact adoption paths or manual dispatch.

The workflow verifies an exact two-file adoption commit:

```text
os2-preview/package-lock.json
os2-preview/dependency-lock-provenance.json
```

The adoption commit must be one commit ahead of, and have its immediate parent equal to, the source commit recorded in provenance.

The adoption workflow requires:

1. Checkout with credentials disabled and `fetch-depth: 2`.
2. Node.js 20.
3. Exact repository, branch, ref, and commit identity.
4. Exactly one immediate-child adoption commit.
5. Exactly the two approved changed files.
6. `dependency-lock-provenance.json` freshness not greater than 168 hours.
7. Exact source-commit, run, workflow, and lock-digest provenance.
8. `node dependency-lock-provenance-verification.js`.
9. `node dependency-lock-adoption-check.js`.
10. `node dependency-lock-verification.js`.
11. Pre-install protected source inventory.
12. `npm ci --ignore-scripts --no-audit --no-fund`.
13. `npm run check`.
14. `npm audit --omit=dev --audit-level=high`.
15. Post-install inventory matching the pre-install digest.
16. `node_modules` removal.
17. A clean Git workspace.
18. Private checksum-backed adoption evidence.
19. Pinned artifact upload.
20. Thirty-day evidence retention.

The adoption workflow has no repository write permission and never commits automatically.

## Generation workflow relationship

`OS2 Dependency Lock Generation` remains manual-only and read-only. It creates a seven-day review artifact, verifies the artifact before upload, and does not commit.

The accepted sequence is:

1. Generate and verify the review artifact.
2. Materialize the verified lock and provenance through the controlled materializer.
3. Commit exactly the two adoption files.
4. Require the adoption workflow to pass.
5. Require normal preview CI to pass on the exact adoption commit.

## Workflow security controls

- Repository permission is read-only.
- Validation failures cannot be ignored.
- CI does not connect to preview or production databases.
- CI does not run migrations, backups, restore tests, workers, deployment, or restart commands.
- Production and merge-execution safety values are forced off.
- Source verification runs before dependency installation.
- Installation uses the committed lock only.
- Install scripts are disabled.
- Dependency audit is mandatory.
- Artifact names include run number and attempt.
- Adoption evidence is bound to the source and adoption commits.

## Secure bounded manifest collection

Directories are canonical real directories opened with `O_DIRECTORY | O_NOFOLLOW`. Files are regular single-link files opened with `O_NOFOLLOW`. Owner, path, device, inode, mode, byte count, and size bounds are enforced.

Collection is bounded to:

- at most 2,000 files;
- at most 16 MiB per file;
- at most 256 MiB total source bytes.

## Build evidence security

Build evidence uses a private `0700` evidence directory and private `0600` evidence files. Files are exclusively created, flushed, and published through atomic publication.

The following checksum pairs are reverified:

- `build-evidence.json` and `build-evidence.sha256`;
- `workspace-source-integrity.json` and `workspace-source-integrity.sha256`;
- `artifact-manifest.json` and `artifact-manifest.sha256`.

## Acceptance rule

Controlled preview installation requires:

1. Normal CI success for the exact controlled-branch commit.
2. Exact repository, branch, ref, workflow, commit, run, attempt, and actor provenance.
3. Reviewed immutable action pins.
4. Checkout credentials not persisted.
5. Dependency-lock verification and governance success.
6. Pre-install source evidence with `packageLockPresent: true`.
7. Installation through `npm ci --ignore-scripts --no-audit --no-fund`.
8. High-severity dependency audit success.
9. Matching pre-install and post-install source digests.
10. `workspaceSourceIntegrityStableAcrossDependencyInstall: true`.
11. Verified build evidence and sidecars.
12. For a newly adopted lock, successful `OS2 Dependency Lock Adoption` evidence.
13. Exact provenance protection in the source inventory.
14. Separate readiness, recovery, migration, schema, and UAT gates.

A source-governance result without an actual committed lock, provenance, adoption evidence, and CI pass is not dependency approval or release approval.

## Production protection

Production at `talk2me.uent.co.za` remains outside this workflow. Neither normal CI nor the adoption workflow has production deployment authority.
