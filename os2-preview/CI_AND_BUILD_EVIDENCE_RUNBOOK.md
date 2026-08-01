# Talk2Me OS2 Preview CI and Build Evidence Runbook

## Purpose

This runbook governs automated validation for the integrated Talk2Me OS2 preview rebuild. It does not deploy the application and it must never modify production.

## Controlled workflow

The workflow `.github/workflows/os2-preview-ci.yml`:

1. Checks out the exact commit and installs Node.js 20.
2. Detects whether `os2-preview/package-lock.json` is committed.
3. Runs `npm run --silent verify:workspace-source-integrity` before dependency installation.
4. Retains the pre-install inventory digest and package-lock state.
5. Confirms dependency-lock detection must agree with source-integrity evidence.
6. Uses `npm install --ignore-scripts --no-audit --no-fund --package-lock=false` while the lockfile remains absent.
7. Runs `npm run check`.
8. Runs the production dependency audit only when the committed lockfile exists.
9. Generates build evidence after validation.
10. Compares the pre-install inventory digest and post-install inventory digest; they must match exactly.
11. Publishes evidence atomically into a private directory and reverifies every checksum pair.
12. Uploads the complete evidence directory as a retained artifact.

## Workflow security controls

- Repository permission is read-only.
- `pull_request_target` and ignored validation failures are prohibited.
- CI does not connect to preview or production databases.
- CI does not run migrations, backups, workers, deployment, or restart commands.
- `ALLOW_PRODUCTION_MUTATION=false` and `ENABLE_CUSTOMER_MERGE_EXECUTION=false` are forced.
- Source verification runs before dependency installation.
- Build evidence runs only after integrated validation.
- Build-evidence source verification has a 30-second timeout, forced `SIGKILL`, and shell execution disabled.

## Dependency-lock policy

The current preview package has no committed `package-lock.json`.

While absent:

- source validation may continue;
- dependency audit remains blocked;
- `dependencyLockPresent: false`;
- `dependencyAuditEligible: false`;
- `releaseCandidateEligible: false`;
- the release-candidate gate must continue to fail.

After a reviewed Node.js 20 lockfile is committed, CI must change to:

```bash
npm ci --ignore-scripts --no-audit --no-fund
```

The exact-commit workflow must then rerun and its evidence artifact must be retained.

## Source-integrity continuity

The pre-install verifier output is retained in `$RUNNER_TEMP/os2-workspace-source-integrity-preinstall.json`. CI extracts the inventory digest and package-lock state. `build-evidence.js` reruns the source verifier after dependency installation and validation.

A successful controlled CI artifact must record:

```text
workspaceSourceIntegrityStableAcrossDependencyInstall: true
```

A mismatch means the protected source changed during CI and invalidates the evidence.

## Secure bounded manifest collection

Broad source evidence is collected only through secure descriptor-based reads.

Every traversed directory must:

- be a real non-symlink canonical directory;
- be opened with `O_DIRECTORY | O_NOFOLLOW`;
- match its path device and inode after secure open;
- not be writable by group or world;
- have the expected owner;
- retain the same device and inode when directory identity is rechecked after traversal.

Every included source file must:

- be a regular non-symlink file;
- be opened with `O_NOFOLLOW`;
- have exactly one hard link;
- match path and descriptor device and inode identities;
- have the expected owner;
- not be writable by group or world;
- retain the same byte count during the descriptor read.

Collection is fail-closed and bounded to:

- at most 2,000 files;
- at most 16 MiB per file;
- at most 256 MiB total source bytes.

Symbolic links, unsupported filesystem entries, ownership changes, directory swaps, hard links, oversized files, excessive file counts, and excessive total bytes stop evidence generation.

Before deleting prior disposable output, an existing `build-evidence` path must be a real directory owned by the executing user. A symlink, regular file, or foreign-owned directory is rejected.

## Atomic evidence publication

The command creates a fresh private `0700` evidence directory. Every evidence file is written to an exclusively created temporary file with `0600`, flushed with `fsync`, and atomically renamed.

It rejects:

- non-regular outputs;
- symbolic links;
- additional hard links;
- ownership mismatches;
- permissions other than `0600`.

The command reverifies:

- `build-evidence.json` with `build-evidence.sha256`;
- `workspace-source-integrity.json` with `workspace-source-integrity.sha256`;
- `artifact-manifest.json` with `artifact-manifest.sha256`.

The artifact manifest confirms:

```text
privateDirectoryVerified: true
atomicPublicationVerified: true
checksumPairsVerified: true
secureManifestDescriptorReads: true
boundedManifestCollection: true
```

All checksum pairs are reverified before upload.

## Evidence contents

The evidence set contains:

- `build-evidence/build-evidence.json`;
- `build-evidence/build-evidence.sha256`;
- `build-evidence/workspace-source-integrity.json`;
- `build-evidence/workspace-source-integrity.sha256`;
- `build-evidence/artifact-manifest.json`;
- `build-evidence/artifact-manifest.sha256`.

Evidence records the exact commit, branch, workflow identifiers, Node.js version, dependency-lock state, pre-install and post-install source digests, protected source inventory, file and byte counts, migration count, route count, validation-check count, bounded collection limits, secure descriptor-read evidence, atomic publication evidence, and checksum verification.

## Acceptance rule

Controlled preview installation requires all of the following:

1. CI succeeds for the exact commit.
2. The pre-install source verifier succeeds.
3. Dependency-lock detection matches the filesystem and source evidence.
4. Pre-install and post-install source digests match.
5. `workspaceSourceIntegrityStableAcrossDependencyInstall: true` is present.
6. A committed lockfile exists.
7. The high-severity production dependency audit passes without unresolved high or critical findings.
8. All three JSON evidence files and sidecars verify.
9. Secure descriptor-based collection, bounded inventory, private directory, atomic publication, and checksum verification are confirmed.
10. Preview readiness, migration, schema verification, pinned restore-evidence verification, and UAT controls pass separately.

A successful source-validation step without a dependency lock is not dependency-audit approval or release approval.

## Failure handling

Do not bypass a failed control. Correct the source, dependency state, permissions, ownership, path topology, or validation contract and rerun CI for the corrected exact commit. Retain failed runs as historical evidence.

## Production protection

Production at `talk2me.uent.co.za` remains outside this workflow. The workflow has no production deployment authority and must not change production.
