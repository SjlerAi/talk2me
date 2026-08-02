# Talk2Me OS2 Preview Activation Runbook

## Purpose

This runbook governs source validation and release preparation for `talk2me.kloka.co.za` before any preview deployment, database migration, restart, smoke test, or formal UAT activity.

## Fixed preview identity

- Application: `talk2me-os2-preview`
- Version: `0.60.0`
- Branch: `agent/talk2me-os2-integrated-rebuild`
- Application root: `/home/kloka/repositories/talk2me/os2-preview`
- Database: `kloka_talk2me`
- Node.js: 20.x
- Production: `talk2me.uent.co.za` must remain untouched
- Customer-merge execution: disabled

## Dependency lock generation

A committed `package-lock.json` is mandatory. A missing lockfile is a hard failure and a hard stop for activation, CI, dependency audit, source approval, and release freeze.

Generate the initial lock only through `DEPENDENCY_LOCK_GENERATION_RUNBOOK.md` or the manual read-only GitHub workflow documented in `DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md`.

The generation path requires:

- Node.js 20 and npm 10;
- the exact controlled branch;
- the exact npm registry;
- lifecycle scripts disabled;
- package-lock-only execution;
- a private temporary workspace;
- private generation evidence;
- independent post-publication lock verification;
- production mutation disabled;
- customer-merge execution disabled.

The source-only preflight runs `dependency-lock-generator-check.js` and `dependency-lock-workflow-check.js`. It never runs the generator or workflow.

## Dependency lock artifact verification

The review artifact must be verified according to `DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md` through `dependency-lock-artifact-verification.js`.

The artifact verifier requires:

- the exact 13-file artifact set;
- a private `0700` canonical directory;
- private `0600` files;
- no hidden entries, nested directories, symbolic links, or additional hard links;
- exact repository, branch, source commit, workflow, run ID, and run-attempt identity;
- exact `SHA256SUMS` coverage;
- constant-time SHA-256 comparisons;
- exact lock identity and reviewed dependencies;
- successful generation, governance, and source-integrity evidence;
- matching pre-install, post-install, and manifest source inventory digests;
- rejection of password, token, secret, authorization, cookie, and database-password fields.

The source-only preflight runs `dependency-lock-artifact-check.js`. It does not execute environment-bound artifact verification.

## Dependency lock adoption

A verified artifact is adopted according to `DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md`.

The controlled materializer `dependency-lock-adoption-materializer.js` reruns artifact verification and then publishes exactly:

```text
package-lock.json
dependency-lock-provenance.json
```

It refuses existing targets, uses exclusive no-overwrite publication, records the exact artifact source commit and workflow identity, and never commits automatically.

The adoption commit must contain exactly these two repository paths:

```text
os2-preview/package-lock.json
os2-preview/dependency-lock-provenance.json
```

The adoption commit must be the immediate child of the generation source commit recorded in provenance.

The `OS2 Dependency Lock Adoption` workflow verifies:

- one immediate-child adoption commit;
- the exact two-file changed set;
- provenance age not greater than 168 hours;
- exact lock and provenance digest binding;
- `npm ci --ignore-scripts --no-audit --no-fund`;
- the complete integrated validation suite;
- `npm audit --omit=dev --audit-level=high`;
- pre-install and post-install source inventory continuity;
- a clean workspace after `node_modules` cleanup;
- private checksum-backed adoption evidence.

The source-only preflight runs `dependency-lock-adoption-check.js`. It never runs `dependency-lock-adoption-materializer.js` or `dependency-lock-provenance-verification.js`.

Successful source-only evidence must retain:

```text
dependencyLockAdoptionGovernanceVerified: true
dependencyLockProvenanceVerificationExecuted: false
dependencyLockAdoptionMaterializationExecuted: false
```

## Dependency lock verification

`dependency-lock-verification.js` must verify:

- exact package and application identity;
- exact reviewed direct dependencies;
- canonical regular package files;
- one-link ownership and safe permissions;
- lockfile version 3;
- npm-registry HTTPS tarball URLs;
- SHA-512 package integrity;
- resolved dependency graph edges;
- no development, linked, bundled, extraneous, or install-script packages;
- production mutation disabled;
- customer-merge execution disabled.

`dependency-lock-governance-check.js` confirms CI, source-protection, and activation wiring. It does not install dependencies.

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

The preflight must execute these 25 controls in this exact order:

1. `workspace-topology-verification.js`
2. `dependency-lock-verification.js`
3. `dependency-lock-governance-check.js`
4. `dependency-lock-generator-check.js`
5. `dependency-lock-workflow-check.js`
6. `dependency-lock-artifact-check.js`
7. `dependency-lock-adoption-check.js`
8. `workspace-source-integrity.js`
9. `workspace-source-integrity-check.js`
10. `workspace-topology-governance-check.js`
11. `migration-ledger-bootstrap-governance-check.js`
12. `migration-ledger-bootstrap-runner-check.js`
13. `migration-ledger-bootstrap-evidence-check.js`
14. `migration-runner-security-check.js`
15. `restore-test-governance-check.js`
16. `restore-test-integration-check.js`
17. `recovery-readiness-check.js`
18. `recovery-release-gate.js`
19. `runtime-release-identity-check.js`
20. `readiness-check.js`
21. `deployment-check.js`
22. `uat-gate-check.js`
23. `release-evidence-security-check.js`
24. `release-source-integrity-check.js`
25. `release-manifest-check.js`

Every child receives a 30-second execution limit, forced `SIGKILL` on timeout, shell execution disabled, inherited output, and fixed preview-only safety values. The preflight stops on startup failure, timeout, signal, or non-zero status.

## Sanitized allowlisted child environment

The complete parent environment is never copied into a child.

Only these operational values may be inherited when present:

```text
PATH
HOME
USER
LOGNAME
TMPDIR
TEMP
TMP
LANG
LC_ALL
TZ
CI
GITHUB_ACTIONS
```

These startup hooks and path overrides are prohibited:

```text
NODE_OPTIONS
NODE_PATH
BASH_ENV
ENV
CDPATH
GIT_DIR
GIT_WORK_TREE
NPM_CONFIG_PREFIX
NPM_CONFIG_USERCONFIG
```

The preflight forces:

```text
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview
DB_NAME=kloka_talk2me
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild
NODE_ENV=production
ALLOW_PRODUCTION_MUTATION=false
ENABLE_CUSTOMER_MERGE_EXECUTION=false
```

The same frozen environment is supplied to all 25 controls.

## Workspace topology verification

The topology verifier proves the executing directory is the configured preview root. It rejects relative, non-normalized, mismatched, linked, unsafe, or owner-inconsistent paths; uses `O_DIRECTORY | O_NOFOLLOW`; compares path and descriptor identity; bounds protected source sizes; and requires all 25 ordered migrations including migration 025.

`package-lock.json` and `dependency-lock-provenance.json` are mandatory for activation and receive the same ownership, path, mode, link, and descriptor controls.

## Deterministic SHA-256 inventory

`workspace-source-integrity.js` creates a deterministic SHA-256 inventory in memory and does not modify the workspace.

The inventory protects:

- `.github/workflows/os2-preview-ci.yml`;
- `.github/workflows/os2-dependency-lock-generation.yml`;
- `.github/workflows/os2-dependency-lock-adoption.yml`;
- `package.json` and `package-lock.json`;
- `dependency-lock-provenance.json` when present;
- dependency lock verification, generation, artifact, provenance, adoption, workflow, and governance controls;
- `DEPENDENCY_LOCK_GENERATION_RUNBOOK.md`;
- `DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md`;
- `DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md`;
- `DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md`;
- migration, recovery, activation, readiness, deployment, UAT, and release controls;
- all ordered migrations and protected runbooks.

The CI workflow file itself is part of the protected source inventory. The dependency-lock workflow is also part of the protected source inventory. The adoption workflow is protected as well.

Each protected file is read using secure descriptor-based reads with `O_NOFOLLOW`, canonical path binding, device and inode comparison, additional hard-link rejection, owner consistency, safe permissions, bounded reads, and exact byte counts.

The canonical filename, byte length, and SHA-256 records are sorted and hashed into one source inventory digest named `inventorySha256`.

## Governed dependency commands

```text
verify:dependency-lock              node dependency-lock-verification.js
generate:dependency-lock            node dependency-lock-generator.js
verify:dependency-lock-artifact     node dependency-lock-artifact-verification.js
materialize:dependency-lock-adoption node dependency-lock-adoption-materializer.js
verify:dependency-lock-provenance   node dependency-lock-provenance-verification.js
check:dependency-lock-governance    node dependency-lock-governance-check.js
check:dependency-lock-generator     node dependency-lock-generator-check.js
check:dependency-lock-workflow      node dependency-lock-workflow-check.js
check:dependency-lock-artifact      node dependency-lock-artifact-check.js
check:dependency-lock-adoption      node dependency-lock-adoption-check.js
```

`npm run check` syntax-checks all dependency-lock controls and executes source-only governance. It must not run dependency-lock generation, artifact verification, adoption materialization, provenance verification, or any GitHub Actions workflow.

## Governed recovery commands

```text
backup:preview                  node backup-runner.js
verify:backup                   node backup-verification.js
restore:test                    node restore-test-runner.js
check:restore-test-governance   node restore-test-governance-check.js
check:restore-test-integration  node restore-test-integration-check.js
check:recovery-readiness        node recovery-readiness-check.js
check:recovery-release          node recovery-release-gate.js
```

Normal validation may syntax-check environment-changing recovery files and execute source-only governance. It must not generate backups, verify backup files, or perform restore testing.

## Approved release source integrity

After successful CI for the exact candidate commit, retain the approved `inventorySha256` as `RELEASE_SOURCE_INVENTORY_SHA256` and run:

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
RELEASE_SOURCE_INVENTORY_SHA256=<approved-ci-inventory-sha256> \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run verify:release-source-integrity
```

Any protected source change invalidates earlier CI approval and requires a new CI run and approved digest.

## Source-only limitations

Successful source governance does not prove artifact verification, adoption materialization, provenance verification, dependency installation, backup execution, restore testing, database migration, preview data verification, deployment, restart, smoke testing, or UAT.

Successful preflight evidence must retain:

```text
dependencyLockProvenanceVerificationExecuted: false
dependencyLockAdoptionMaterializationExecuted: false
dependencyLockArtifactVerificationExecuted: false
dependencyLockGenerationWorkflowExecuted: false
dependencyLockGenerationExecuted: false
dependencyInstallationExecuted: false
backupRuntimeExecuted: false
backupVerificationExecuted: false
restoreTestExecuted: false
databaseBackedVerificationExecuted: false
migrationsExecuted: false
previewRestartExecuted: false
productionMutationEnabled: false
mergeExecutionEnabled: false
```

## Activation sequence

1. Confirm the controlled branch and exact intended commit.
2. Generate the dependency-lock review artifact through the controlled manual workflow.
3. Verify the artifact and `SHA256SUMS`.
4. Materialize `package-lock.json` and `dependency-lock-provenance.json` through the controlled materializer.
5. Review both files and commit exactly those two paths as the immediate child of the generation source commit.
6. Require the adoption workflow to pass.
7. Repeat the source-only activation preflight.
8. Run `npm ci --ignore-scripts --no-audit --no-fund` from the committed lock.
9. Run the integrated validation suite.
10. Run `npm audit --omit=dev --audit-level=high`.
11. Retain exact CI source inventory and build evidence.
12. Verify approved release-source integrity.
13. Generate and verify the preview database backup.
14. Pre-create an empty isolated restore database.
15. Run the isolated restore test and require zero failed checks.
16. Execute the one-time migration-ledger bootstrap.
17. Verify the bootstrap evidence pair.
18. Apply the 25 ordered preview migrations.
19. Require advisory-lock release and database closure evidence.
20. Run preview-data verification.
21. Re-run approved source-integrity verification before formal UAT.
22. Complete automated and manual preview UAT.
23. Re-run source-integrity verification before release freeze.
24. Freeze and verify the release manifest.
25. Restart only the preview Node.js application.
26. Run technical smoke testing.
27. Record all evidence in GitHub Issue #83.

## Recovery, bootstrap, and release controls

Backup generation is preview-only, branch-bound, private-directory restricted, checksum-backed, bounded, and fail-closed. Restore testing requires a pre-created empty isolated database, checksum reverification, a sanitized bounded import process, matching table counts, core tables, exactly 25 valid migration rows, and zero failed checks.

The migration-ledger bootstrap refuses every database except `kloka_talk2me`, requires verified backup evidence, refuses an existing migration ledger, verifies advisory-lock lifecycle, confirms the exact empty ledger, and publishes private evidence only after MySQL closes.

The migration runner reverifies bootstrap evidence, freezes migration sources, requires a checksum-matching strict ledger prefix, applies remaining migrations in order, confirms lock release, and closes MySQL before final success.

Release-manifest verification reruns source-integrity verification and securely verifies the manifest, checksum sidecar, package files, bootstrap source, every migration, and private bootstrap evidence.

## Hard-stop conditions

Stop when:

- preview root identity differs;
- protected paths are unsafe;
- a source-only child exceeds 30 seconds;
- `package-lock.json` is absent;
- dependency-lock verification fails;
- generator, workflow, artifact, or adoption governance fails;
- artifact verification fails;
- adoption provenance is stale or inconsistent;
- the adoption commit is not the immediate child of the recorded source commit;
- the adoption changed-file set differs from the exact two files;
- Node.js is not 20.x;
- production mutation or merge execution is enabled;
- the source inventory differs from the approved CI digest;
- the dependency audit has unresolved high or critical findings;
- verified backup or restore evidence is missing;
- bootstrap or migration evidence is incomplete;
- preview-data verification fails;
- UAT evidence is incomplete;
- release-manifest verification fails;
- the exact deployed commit cannot be proven.

The dependency lock has not been generated or committed. The dependency-lock generation workflow, artifact verifier, adoption materializer, provenance verifier, and adoption workflow have not been executed. The migration-ledger bootstrap, migration 025, preview data verification, deployment, restart, and formal UAT have not yet been executed.
