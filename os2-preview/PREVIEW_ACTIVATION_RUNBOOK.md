# Talk2Me OS2 Preview Activation Runbook

## Purpose

This runbook controls source validation before any deployment, migration, restart, or formal UAT activity for `talk2me.kloka.co.za`.

## Fixed preview identity

- Application: `talk2me-os2-preview`
- Version: `0.59.0`
- Branch: `agent/talk2me-os2-integrated-rebuild`
- Application root: `/home/kloka/repositories/talk2me/os2-preview`
- Database: `kloka_talk2me`
- Node.js: 20.x
- Production: `talk2me.uent.co.za` must remain untouched
- Customer-merge execution: disabled

## Mandatory source-only preflight

Run from `/home/kloka/repositories/talk2me/os2-preview`:

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run verify:preview-activation-preflight
```

The preflight must execute these controls in this exact order:

1. `workspace-topology-verification.js`
2. `workspace-source-integrity.js`
3. `workspace-source-integrity-check.js`
4. `workspace-topology-governance-check.js`
5. `migration-ledger-bootstrap-governance-check.js`
6. `migration-ledger-bootstrap-runner-check.js`
7. `migration-ledger-bootstrap-evidence-check.js`
8. `migration-runner-security-check.js`
9. `runtime-release-identity-check.js`
10. `readiness-check.js`
11. `deployment-check.js`
12. `uat-gate-check.js`
13. `release-evidence-security-check.js`
14. `release-source-integrity-check.js`
15. `release-manifest-check.js`

Every child control has a 30-second execution limit, forced `SIGKILL` termination on timeout, shell execution disabled, inherited output, and fixed preview-only safety flags. The preflight must stop immediately when a child cannot start, times out, is interrupted, or returns a non-zero status. A timeout is a failed activation preflight, not a warning and not permission to continue manually.

## Sanitized child environment

Each preflight child runs in a sanitized allowlisted child environment. The complete parent environment is never copied into a child process.

Only these operational variables may be inherited when present: `PATH`, `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `TEMP`, `TMP`, `LANG`, `LC_ALL`, `TZ`, `CI`, and `GITHUB_ACTIONS`.

These startup hooks and path overrides are explicitly prohibited from inheritance: `NODE_OPTIONS`, `NODE_PATH`, `BASH_ENV`, `ENV`, `CDPATH`, `GIT_DIR`, `GIT_WORK_TREE`, `NPM_CONFIG_PREFIX`, and `NPM_CONFIG_USERCONFIG`.

The preflight always forces:

```text
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview
DB_NAME=kloka_talk2me
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild
NODE_ENV=production
ALLOW_PRODUCTION_MUTATION=false
ENABLE_CUSTOMER_MERGE_EXECUTION=false
```

The resulting environment object is frozen before the first child starts, its key count is bounded, and the same immutable environment is supplied to all 15 ordered controls. This prevents a parent shell, local npm configuration, Node startup option, Git work-tree override, or child control from silently changing the execution context. Production mutation and merge execution are forced off in every child.

Successful preflight evidence must report `childEnvironmentSanitized: true`, `childEnvironmentAllowlistApplied: true`, `childEnvironmentFrozen: true`, and false inheritance markers for all prohibited variables.

## Workspace topology verification

Before any other activation control, the workspace verifier must prove that the executing directory is the configured preview application root.

It must reject a missing, relative, non-normalized, or mismatched `PREVIEW_APP_ROOT`; validate the application root and migrations directory as real non-symlink directories; open directory descriptors with `O_DIRECTORY | O_NOFOLLOW`; compare path and descriptor device/inode identities; reject group-writable or world-writable protected paths; require protected source files to share the preview-root owner; reject symbolic links and additional hard links; enforce bounded file sizes; require at least 25 ordered migration files and migration 025; and re-check directory identity after inventory validation.

A missing `package-lock.json` remains a release-freeze blocker. Once present, it must pass the same ownership, permissions, symlink, hard-link, descriptor-identity and bounded-size controls.

## Deterministic source integrity inventory

Immediately after topology verification, `workspace-source-integrity.js` must create a deterministic SHA-256 inventory in memory and print it to inherited preflight output. It must not modify the workspace or write evidence files.

The inventory covers the package and server entrypoint, bootstrap and migration controls, activation controls, readiness/deployment/UAT gates, release source verification, release freeze and post-freeze verification, all related governance checks, the activation/deployment/UAT/release/CI evidence runbooks, and every ordered migration.

The inventory is self-protecting: it must include `workspace-source-integrity.js` itself and `workspace-source-integrity-check.js`. It must also include workspace topology governance, activation governance, release source-integrity governance, and release-manifest governance. A governance script that defines what is protected cannot sit outside the protected inventory.

The CI workflow file itself is part of the protected source inventory. A change to `.github/workflows/os2-preview-ci.yml` must therefore change `inventorySha256`, invalidate earlier CI source evidence, and require a new exact-commit CI cycle.

Each source is read through secure descriptor-based reads using `O_NOFOLLOW`, canonical path binding, device/inode comparison, additional hard-link rejection, ownership consistency, safe permission checks and bounded reads.

The canonical inventory record contains the relative filename, byte length and SHA-256 checksum for each protected file. Records are sorted by filename and hashed again to produce one source inventory digest named `inventorySha256`.

Retain the full source inventory output with activation evidence. A different source inventory digest means the source surface changed and the previous activation evidence is no longer applicable.

## Approved release source integrity

The source-only preflight validates the release source-integrity governance code but does not execute the environment-bound verifier. After successful CI for the exact candidate commit, retain the approved workspace inventory digest as `RELEASE_SOURCE_INVENTORY_SHA256`.

Run:

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
RELEASE_SOURCE_INVENTORY_SHA256=<approved-ci-inventory-sha256> \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run verify:release-source-integrity
```

The verifier must complete within 30 seconds, run with shell execution disabled, require the committed `package-lock.json` in the protected inventory, and report both `exactApprovedInventoryMatched: true` and `packageLockPresent: true`.

Any source change after CI approval invalidates the candidate. That includes edits to code, governance checks, runbooks, package metadata, the dependency lock, bootstrap source, migration source, or any other protected file. A changed candidate requires a new CI run, new retained source inventory, and a new approved digest.

Re-run approved source-integrity verification immediately before formal UAT. Re-run approved source-integrity verification immediately before release freeze. These are separate evidence points; an earlier successful result must not be reused after migrations, verification activity, manual edits, dependency work, or any other source-affecting operation.

## Preflight limitations

A successful preflight proves only source-governance readiness. It does not mean dependencies are installed, `package-lock.json` exists, the preview database has been backed up, the migration-ledger bootstrap or migrations have run, preview data verification has passed, approved source integrity has passed, a release manifest has been frozen, preview has restarted, smoke testing has passed, or formal UAT has started.

The successful preflight output must retain:

```text
databaseBackedVerificationExecuted: false
migrationsExecuted: false
previewRestartExecuted: false
productionMutationEnabled: false
mergeExecutionEnabled: false
```

## Activation sequence after source preflight

1. Confirm the controlled branch and exact intended commit.
2. Generate and commit `package-lock.json` in a trusted Node.js 20 environment.
3. Repeat source-only preflight so the lockfile is included.
4. Run `npm ci` from the committed lockfile.
5. Run `npm run check`, `npm run check:readiness`, `npm run check:deployment`, and `npm run check:uat-gate`.
6. Retain the approved CI workspace source inventory and set `RELEASE_SOURCE_INVENTORY_SHA256` to its exact digest.
7. Run `npm run verify:release-source-integrity` and retain the successful output.
8. Back up and verify `kloka_talk2me`; retain the backup reference and SHA-256.
9. Create a private canonical evidence directory inaccessible to group and world users.
10. Execute the one-time ledger bootstrap only with `npm run bootstrap:migration-ledger`, preview-only flags, verified backup evidence, named operator, approved change reference, and an absolute `MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH`.
11. Verify the bootstrap evidence pair with `npm run verify:migration-ledger-bootstrap-evidence`.
12. Apply migrations only with the same evidence path, `ALLOW_PREVIEW_MIGRATIONS=true`, `DB_NAME=kloka_talk2me`, production mutation disabled, and merge execution disabled.
13. Accept migration completion only when the final JSON proves evidence verification before MySQL, advisory-lock release, and database-connection closure.
14. Run `DB_NAME=kloka_talk2me npm run verify:preview-data`.
15. Re-run approved source-integrity verification immediately before formal UAT and retain new output.
16. Complete automated and manual preview UAT and retain evidence.
17. Re-run approved source-integrity verification immediately before release freeze and retain new output.
18. Freeze the release manifest against the exact commit, controlled branch, approved source digest and bootstrap evidence pair.
19. Verify the frozen release manifest against the same checkout, approved source digest and retained bootstrap evidence pair.
20. Restart only the preview Node.js application.
21. Run technical smoke testing.
22. Record all results in GitHub Issue #83.

## Bootstrap and migration controls

The bootstrap runner must refuse every database except `kloka_talk2me`, require verified backup evidence, refuse an existing migration ledger, securely read the reviewed bootstrap source, acquire and verify the preview advisory lock, verify the created schema and empty ledger, confirm lock release, close MySQL before publishing evidence, and atomically publish private JSON evidence and its SHA-256 sidecar.

The migration runner must re-run the bootstrap evidence verifier before opening MySQL. It must securely freeze migration sources, validate the ledger as an exact checksum-matching strict prefix, apply only remaining ordered migrations, confirm lock release, close MySQL and only then print final success.

Individual `applied <migration>` lines are not completion evidence.

## Secure release-evidence verification

After release freeze, `release-manifest-verification.js` must receive the exact commit SHA, controlled branch, approved source digest and absolute canonical manifest path. It must first rerun approved source-integrity verification, then securely verify the release manifest and checksum sidecar, `package.json`, `package-lock.json`, `MIGRATION_LEDGER_BOOTSTRAP.sql`, every migration source, and the private bootstrap execution evidence pair.

Protected reads must reject symbolic links, additional hard links, non-canonical paths, descriptor identity changes, invalid private permissions and oversized files. They must use `O_NOFOLLOW` and descriptor-based reads. Checksums must use constant-time comparison where applicable.

## Hard-stop conditions

Do not proceed when the preview root identity differs, protected paths are unsafe, any source-only child exceeds the 30-second limit, the source inventory differs from the approved CI digest, any protected source changed after CI approval, the database or branch identity is wrong, Node.js is not 20.x, production mutation or merge execution is enabled, `package-lock.json` is absent, approved source-integrity verification has not passed at the required point, verified backup or bootstrap evidence is missing, migration completion cannot prove lock release and connection closure, preview data verification fails, UAT evidence is incomplete, secure release-manifest verification fails, or the exact deployed commit cannot be proven.

The migration-ledger bootstrap, migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.
