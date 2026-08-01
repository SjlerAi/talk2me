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
14. `release-manifest-check.js`

Stop immediately if any control cannot start, is interrupted, or returns a non-zero status. Every child process must inherit output and receive `ALLOW_PRODUCTION_MUTATION=false` and `ENABLE_CUSTOMER_MERGE_EXECUTION=false`.

## Workspace topology verification

Before any other activation control, the workspace verifier must prove that the executing directory is the configured preview application root.

It must:

- reject a missing, relative, non-normalized, or mismatched `PREVIEW_APP_ROOT`;
- validate the application root and migrations directory as real non-symlink directories;
- open directory descriptors with `O_DIRECTORY | O_NOFOLLOW`;
- compare path and descriptor device/inode identities;
- reject group-writable or world-writable protected paths;
- require protected source files to share the preview-root owner;
- open protected workspace files with `O_NOFOLLOW`;
- compare each protected file path and descriptor device/inode identity;
- reject symbolic links and additional hard links for `package.json`, an existing `package-lock.json`, `MIGRATION_LEDGER_BOOTSTRAP.sql`, and all migration files;
- enforce bounded file sizes;
- require at least 25 ordered migration files and explicit migration 025 presence;
- re-check directory identity after migration inventory validation.

A missing `package-lock.json` is reported during source preparation but remains a release-freeze blocker. Once the lockfile exists, it must pass the same ownership, permissions, symlink, hard-link, descriptor-identity and bounded-size controls.

## Deterministic source integrity inventory

Immediately after topology verification, `workspace-source-integrity.js` must create a deterministic SHA-256 inventory in memory and print it to inherited preflight output. It must not modify the workspace or write evidence files.

The inventory covers critical activation, migration, release, UAT, package and server sources plus every ordered migration. Each source is read through secure descriptor-based reads using `O_NOFOLLOW`, canonical path binding, device/inode comparison, additional hard-link rejection, ownership consistency, safe permission checks and bounded reads.

The canonical inventory record contains the relative filename, byte length and SHA-256 checksum for each protected file. Records are sorted by filename and hashed again to produce one source inventory digest named `inventorySha256`.

`workspace-source-integrity-check.js` must then confirm that the integrity verifier still protects the expected inventory contract and remains in the activation sequence before wider governance checks.

Retain the full source inventory output with activation evidence. A different source inventory digest means the source surface changed and the previous activation evidence is no longer applicable.

## Preflight limitations

A successful preflight proves only source-governance readiness. It does not mean that:

- dependencies have been installed;
- `package-lock.json` exists;
- the preview database has been backed up;
- the migration-ledger bootstrap has been executed;
- bootstrap execution evidence exists;
- migrations have been applied;
- preview data verification has passed;
- a release manifest has been frozen;
- the preview application has been restarted;
- smoke testing has passed;
- formal UAT has started.

The successful preflight output must retain:

```text
databaseBackedVerificationExecuted: false
migrationsExecuted: false
previewRestartExecuted: false
productionMutationEnabled: false
mergeExecutionEnabled: false
```

## Activation sequence after source preflight

1. Confirm the checkout is on the controlled branch and intended commit.
2. Generate and commit `package-lock.json` in a trusted Node.js 20 environment.
3. Repeat the source-only preflight so the committed lockfile is included.
4. Run `npm ci` from the committed lockfile.
5. Run `npm run check`, `npm run check:readiness`, `npm run check:deployment`, and `npm run check:uat-gate`; retain complete output.
6. Back up and verify `kloka_talk2me`; record the backup reference and SHA-256.
7. Create a private canonical evidence directory inaccessible to group and world users.
8. Execute the one-time ledger bootstrap only with `npm run bootstrap:migration-ledger`, explicit preview-only flags, verified backup evidence, named operator, approved change reference, and an absolute `MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH`.
9. Verify the generated bootstrap evidence JSON and SHA-256 sidecar with `npm run verify:migration-ledger-bootstrap-evidence`.
10. Apply migrations only with the same bootstrap evidence path, `ALLOW_PREVIEW_MIGRATIONS=true`, `DB_NAME=kloka_talk2me`, `ALLOW_PRODUCTION_MUTATION=false`, and `ENABLE_CUSTOMER_MERGE_EXECUTION=false`.
11. Accept migration completion only when the final JSON result reports evidence verification before MySQL, advisory-lock release, and database-connection closure.
12. Run `DB_NAME=kloka_talk2me npm run verify:preview-data`.
13. Complete automated and manual preview UAT and retain evidence.
14. Freeze the release manifest against the exact commit, controlled branch and bootstrap evidence pair.
15. Verify the frozen release manifest against the same checkout and retained bootstrap evidence pair.
16. Restart only the preview Node.js application.
17. Run technical smoke testing.
18. Record all results in GitHub Issue #83.

## Bootstrap and migration controls

The bootstrap runner must:

- refuse every database except `kloka_talk2me`;
- require verified backup reference and SHA-256;
- refuse an existing migration ledger;
- securely read the reviewed bootstrap source;
- acquire and verify the preview migration advisory lock;
- verify the created schema and empty ledger;
- confirm advisory-lock release;
- close MySQL before publishing evidence;
- atomically publish private JSON evidence and its SHA-256 sidecar.

The migration runner must re-run the bootstrap evidence verifier before opening MySQL. It must securely freeze migration sources, validate the ledger as an exact checksum-matching strict prefix, apply only remaining ordered migrations, confirm lock release, close MySQL and only then print final success.

Individual `applied <migration>` lines are not completion evidence.

## Secure release-evidence verification

After release freeze, `release-manifest-verification.js` must receive the exact commit SHA, controlled branch and absolute canonical manifest path.

It must securely verify:

- the release manifest and checksum sidecar;
- `package.json` and `package-lock.json`;
- `MIGRATION_LEDGER_BOOTSTRAP.sql`;
- every migration source in exact order;
- the private bootstrap execution evidence JSON and checksum sidecar.

Protected reads must reject symbolic links, additional hard links, non-canonical paths, descriptor identity changes, invalid private permissions and oversized files. They must use `O_NOFOLLOW` and descriptor-based reads. Checksums must use constant-time comparison where applicable.

Example:

```bash
RELEASE_COMMIT_SHA=<exact-40-character-sha> \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
RELEASE_MANIFEST_PATH=/absolute/private/canonical/path/release-manifest.json \
node release-manifest-verification.js
```

Stop when any frozen checksum, commit identity, branch identity, bootstrap evidence field, migration inventory or protected source differs.

## Hard-stop conditions

Do not proceed when:

- `PREVIEW_APP_ROOT` differs from `/home/kloka/repositories/talk2me/os2-preview`;
- the preview root, migrations directory or evidence directory is a symbolic link, changes identity, or has unsafe permissions;
- protected files have inconsistent ownership, symbolic links, additional hard links, path/descriptor identity changes, or exceed bounded sizes;
- the source inventory digest differs from the evidence retained for the intended activation attempt;
- `DB_NAME` is not exactly `kloka_talk2me`;
- Node.js is not 20.x;
- the branch is not `agent/talk2me-os2-integrated-rebuild`;
- `ALLOW_PRODUCTION_MUTATION=true`;
- `ENABLE_CUSTOMER_MERGE_EXECUTION=true`;
- `package-lock.json` is absent before release freeze;
- verified preview backup evidence is missing;
- bootstrap evidence is absent or unverifiable;
- the migration ledger already exists before the controlled one-time bootstrap;
- migration completion cannot prove advisory-lock release and connection closure;
- preview data verification fails;
- UAT evidence is incomplete;
- secure release-manifest verification fails;
- the exact deployed commit cannot be proven.

The migration-ledger bootstrap, migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.
