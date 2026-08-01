# Talk2Me OS2 Preview Release Candidate Runbook

## Purpose

This procedure controls the point at which a development build may be frozen as a preview release candidate. It does not authorise production deployment or customer-merge execution.

## Mandatory prerequisites

1. A reviewed `package-lock.json` is committed.
2. GitHub validation has completed successfully for the exact candidate commit.
3. The retained CI build evidence contains a successful workspace source-integrity record and deterministic inventory SHA-256.
4. The exact approved workspace source digest is recorded as `RELEASE_SOURCE_INVENTORY_SHA256`.
5. `node release-source-integrity-verification.js` passes against the exact candidate checkout and requires `package-lock.json` to be included in the protected inventory.
6. A verified preview backup exists and its reference and SHA-256 were used by the controlled migration-ledger bootstrap runner.
7. The migration-ledger bootstrap was executed only with `npm run bootstrap:migration-ledger` against `kloka_talk2me`.
8. The private bootstrap execution evidence JSON and SHA-256 sidecar exist at the approved absolute canonical path.
9. `npm run verify:migration-ledger-bootstrap-evidence` passes for that exact evidence pair and checked-out bootstrap source.
10. All preview migrations, including `20260801_025_merge_authorisation_restore_pin.sql`, have been applied to `kloka_talk2me` only.
11. The migration runner used the same `MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH`, verified it before opening MySQL, released the advisory lock, and closed the database connection before final success.
12. `DB_NAME=kloka_talk2me npm run verify:preview-data` passes against the preview database.
13. Preview data verification runs `schema-verification.js` first and `merge-restore-evidence-verification.js` second.
14. Running only `npm run verify:schema` or only `npm run verify:merge-restore-evidence` is not sufficient release evidence.
15. `npm run check:merge-restore-pin` passes.
16. `npm run check:customer-merge-execution-readiness` confirms exact restore evidence is pinned and merge execution remains disabled.
17. Automated preview UAT and the documented manual UAT stages are complete.
18. Security, privacy, communications, worker, deployment and UAT governance checks have been evidenced.
19. The candidate commit SHA, controlled branch, approver and change reference are recorded.

Stop the release-candidate process if source-integrity verification, bootstrap evidence verification, migration completion evidence, preview data verification, UAT, or any required governance control fails, is interrupted, or cannot start.

## Required evidence order

Record evidence in this order so later evidence cannot silently replace earlier approval inputs:

1. exact candidate commit, controlled branch and preview version;
2. committed dependency lock and dependency audit result;
3. retained CI workspace source-integrity JSON, checksum sidecar and deterministic inventory SHA-256;
4. successful release source-integrity verification against the exact approved workspace source digest;
5. verified preview backup reference, SHA-256 and database identity;
6. migration-ledger bootstrap source SHA-256;
7. bootstrap execution evidence JSON and SHA-256 sidecar;
8. successful bootstrap evidence verification output;
9. final migration completion output showing evidence verification before MySQL, advisory-lock release and connection closure;
10. isolated restore-test ID for the verified backup;
11. successful preview data verification showing schema-first and restore-evidence-second completion;
12. restore-pin and merge-readiness checks;
13. automated and manual UAT evidence;
14. release-candidate manifest and checksum sidecar;
15. post-freeze manifest verification against the exact checkout and bootstrap evidence pair.

A newer source inventory, restore test, backup, bootstrap evidence pair or migration output must not be substituted for evidence already used by the candidate.

## Approved source-integrity verification

Before release freeze, copy the deterministic `workspaceSourceInventorySha256` value from the retained CI build evidence. Do not calculate or approve a different digest from an unreviewed checkout.

Run from the exact candidate checkout:

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
RELEASE_SOURCE_INVENTORY_SHA256=<approved-64-character-sha256> \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
node release-source-integrity-verification.js
```

This verifier reruns `workspace-source-integrity.js` using secure descriptor-based reads and requires the current deterministic inventory digest to match the approved CI digest exactly. It also requires the committed `package-lock.json` to be included in the protected inventory.

A digest mismatch means the checkout differs from the approved source state. Stop immediately and create a new exact-commit validation and evidence cycle.

## Freeze command

Run from the preview application directory with the exact candidate identity, the same bootstrap evidence path used by controlled migration, and an absolute private release-manifest path:

```bash
RELEASE_COMMIT_SHA=<exact-40-character-git-sha> \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
RELEASE_APPROVED_BY=<name> \
RELEASE_CHANGE_REFERENCE=<issue-or-change-reference> \
MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH=/absolute/private/canonical/path/bootstrap-evidence.json \
RELEASE_MANIFEST_PATH=/absolute/private/canonical/path/talk2me-release-manifest.json \
npm run check:release-candidate
```

The freeze must fail when:

- the dependency lock is absent;
- the exact commit or branch identity is missing or invalid;
- approved source-integrity evidence is absent or does not match the current protected source inventory;
- bootstrap evidence is absent, modified, non-private, non-canonical or fails verification;
- the bootstrap source checksum differs from the checked-out source;
- verified backup evidence is incomplete;
- ledger absence, exact table creation, schema verification or empty-ledger proof is missing;
- advisory-lock ownership or release proof is incomplete;
- runtime table creation is detected;
- migration 025 or merge recovery controls are missing;
- release metadata is incomplete;
- production mutation or customer-merge execution is enabled.

The release manifest must freeze the bootstrap evidence path, bootstrap evidence SHA-256, bootstrap evidence-sidecar SHA-256, bootstrap source SHA-256, dependency-lock SHA-256, package manifest SHA-256 and each migration SHA-256.

## Post-freeze manifest verification

Immediately after the freeze succeeds, verify the manifest and all bound sources from the same checkout:

```bash
RELEASE_COMMIT_SHA=<exact-40-character-git-sha> \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
RELEASE_MANIFEST_PATH=/absolute/private/canonical/path/talk2me-release-manifest.json \
node release-manifest-verification.js
```

The verifier must securely reopen and validate:

- the release-manifest JSON and SHA-256 sidecar;
- `package.json` and the committed `package-lock.json`;
- `MIGRATION_LEDGER_BOOTSTRAP.sql`;
- every migration source in exact order;
- the bootstrap execution evidence JSON and its SHA-256 sidecar.

Verification must fail when:

- an evidence path is missing, relative, non-normalized or non-canonical;
- an evidence directory is a symbolic link or is accessible to group or world users;
- a protected file is a symbolic link, has additional hard links, changes pathname/descriptor identity, exceeds its size limit or has invalid permissions;
- `O_NOFOLLOW` is unavailable;
- a checksum sidecar has the wrong format or filename;
- any frozen SHA-256 differs from the checked-out or retained source;
- commit identity or branch identity differs from the candidate;
- migration 025 is absent or migration order differs;
- bootstrap evidence no longer proves the preview database, reviewed source, verified backup, absent ledger, exact table creation, schema verification, empty ledger and complete lock lifecycle;
- preview data verification requirements are absent;
- `runtimeLedgerCreationDisabled` is not `true`;
- `mergeExecutionEnabled` is not `false`.

Retain the successful verification output with the release evidence. Re-run verification whenever the manifest or bootstrap evidence is copied or retrieved from storage. A failed verification invalidates the candidate until the evidence chain is investigated and recreated.

## Evidence retained

- Exact commit SHA, controlled branch and preview version
- Package manifest and dependency-lock SHA-256 values
- Retained workspace source-integrity JSON and checksum sidecar
- Approved deterministic workspace source inventory SHA-256
- Successful release source-integrity verification output
- Verified preview backup reference, database identity and SHA-256
- Bootstrap source filename and SHA-256
- Private bootstrap execution evidence JSON and SHA-256 sidecar
- Successful bootstrap evidence-verification output
- Final migration completion output showing evidence verification before MySQL, advisory-lock release and connection closure
- Migration inventory and SHA-256 checksum per migration
- Migration 025 presence and checksum
- Required runbook, validation and package-command inventories
- Release approver and change reference
- Private release-manifest JSON and SHA-256 sidecar
- Successful post-freeze manifest-verification output
- GitHub Actions run URL and build-evidence artifact
- Pinned restore-test ID and backup relationship
- Restore environment, restored database, completion time and failed-check count
- `verify:preview-data` output and exact verifier order
- `check:merge-restore-pin` output
- Merge readiness output showing `executionAvailable: false`
- Automated and manual UAT evidence

## Merge execution protection

Release-candidate freeze does not enable customer-merge execution. The release manifest must retain:

```text
mergeExecutionEnabled: false
```

Any future merge execution implementation requires a separate reviewed change, explicit transactional controls, rollback evidence and a new release-candidate cycle.

## Change control after freeze

Any code, migration, package, bootstrap source, bootstrap execution evidence, backup, restore evidence or configuration change after candidate freeze invalidates the candidate. A new commit, validation run, source-integrity evidence, backup, bootstrap evidence pair, migration run, restore test, manifest and UAT evidence set is required.

## Production protection

This runbook applies only to `talk2me.kloka.co.za` and database `kloka_talk2me`. It must not be used to deploy, migrate, restart or modify `talk2me.uent.co.za`.

## Current blocker

The branch does not yet contain a generated and reviewed `package-lock.json`. The release-candidate gate is therefore intentionally expected to fail until dependencies are installed in a controlled Node.js 20 environment and the resulting lockfile is reviewed and committed.

The migration-ledger bootstrap, migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.
