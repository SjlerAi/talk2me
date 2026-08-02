# Talk2Me OS2 Preview Release Candidate Runbook

## Purpose

This procedure controls the point at which a development build may be frozen as a preview release candidate. It does not authorise production deployment or customer-merge execution.

## Mandatory prerequisites

1. A reviewed `package-lock.json` is committed.
2. GitHub validation has completed successfully for the exact candidate commit.
3. Retained CI evidence contains the successful workspace source-integrity JSON, checksum sidecar and deterministic inventory SHA-256.
4. The approved digest is recorded as `RELEASE_SOURCE_INVENTORY_SHA256`.
5. `node release-source-integrity-verification.js` passes against the exact checkout and requires `package-lock.json to be included in the protected inventory`.
6. A verified preview backup exists and its reference and SHA-256 were used by the controlled migration-ledger bootstrap runner.
7. The migration-ledger bootstrap ran only against `kloka_talk2me` and produced a private JSON evidence pair.
8. All ordered migrations, including `20260801_025_merge_authorisation_restore_pin.sql`, were applied by the controlled migration runner.
9. Migration completion proves bootstrap-evidence verification before MySQL, advisory-lock release and database-connection closure.
10. `DB_NAME=kloka_talk2me npm run verify:preview-data` passed in the required order.
11. Automated and manual UAT evidence is complete.
12. Production mutation and customer-merge execution remain disabled.

Stop when any source, dependency, backup, bootstrap, migration, restore, preview-data, UAT, release-freeze or post-freeze control fails, times out, is interrupted or cannot start.

## Required evidence order

1. Exact commit, controlled branch and version.
2. Dependency lock and audit result.
3. CI workspace source inventory and digest.
4. Approved release source-integrity output.
5. Verified preview backup evidence.
6. Bootstrap source and private bootstrap execution evidence pair.
7. Migration completion evidence.
8. Restore evidence and preview-data verification.
9. Automated and manual UAT evidence.
10. Release manifest and checksum sidecar.
11. Post-freeze manifest verification.

A newer checkout, digest, backup, bootstrap result, migration result or restore test must not be substituted into an already frozen candidate.

## Approved source-integrity verification

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

A digest mismatch invalidates the candidate and requires a new exact-commit CI and evidence cycle.

## Freeze command

```bash
RELEASE_COMMIT_SHA=<exact-40-character-git-sha> \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
RELEASE_APPROVED_BY=<name> \
RELEASE_CHANGE_REFERENCE=<issue-or-change-reference> \
RELEASE_SOURCE_INVENTORY_SHA256=<approved-64-character-sha256> \
MIGRATION_LEDGER_BOOTSTRAP_EVIDENCE_PATH=/absolute/private/canonical/path/bootstrap-evidence.json \
RELEASE_MANIFEST_PATH=/absolute/private/canonical/path/talk2me-release-manifest.json \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run check:release-candidate
```

The freeze must fail when the lock is absent, exact identity is missing, approved source differs, bootstrap evidence is unsafe or incomplete, migration evidence is incomplete, release metadata is invalid, or either mutation safety flag is enabled.

## Exact release-manifest semantic contract

Post-freeze verification does not accept a manifest merely because its checksum is valid. The manifest must satisfy the complete semantic contract below.

1. Application identity is exactly `talk2me-os2-preview`.
2. Version is exactly `0.60.0`.
3. Branch is exactly `agent/talk2me-os2-integrated-rebuild`.
4. Commit identity is a full 40-character SHA and matches the verified checkout.
5. Approver evidence is present, trimmed, bounded and control-character free.
6. Change reference is present, trimmed, bounded and control-character free.
7. `generatedAt` uses canonical UTC ISO-8601 format.
8. `generatedAt` is not more than five minutes in the future.
9. The manifest is no older than 30 days.
10. `packageJsonSha256` has valid SHA-256 syntax.
11. `dependencyLockSha256` has valid SHA-256 syntax.
12. `approvedSourceInventorySha256` has valid SHA-256 syntax.
13. `migrationLedgerBootstrapSha256` has valid SHA-256 syntax.
14. The dependency lock is explicitly present.
15. Release source integrity is explicitly verified.
16. Release source evidence confirms the dependency lock.
17. The source protected-file count is valid.
18. The source migration count is valid.
19. Reverification must reproduce the frozen source protected-file count.
20. Reverification must reproduce the frozen source migration count.
21. The bootstrap filename is exact.
22. The bootstrap evidence pair was verified before release freeze.
23. Runtime ledger creation is disabled.
24. Migration completion requires confirmed lock release.
25. Migration success requires connection closure.
26. Production mutation remains false.
27. Merge execution remains false.
28. The manifest failures array exists and is empty.
29. `restorePinMigration` is exactly `20260801_025_merge_authorisation_restore_pin.sql`.
30. `previewDataVerificationRequired` is true.
31. `previewDataVerificationOrder` is exactly schema first and restore evidence second.
32. The exact required-file inventory is present in the frozen order.
33. The exact required-script inventory is present in the frozen order.
34. Required-file and required-script inventories contain no duplicates.
35. `migrationCount` equals the actual ordered migration count.
36. The frozen migration inventory length equals the actual migration count.
37. migration filenames are unique.
38. Migration filenames remain in exact sorted order.
39. migration checksum formats are valid SHA-256.
40. Every migration checksum matches the secure descriptor read.
41. The restore-pin migration exists in the checked-out inventory.
42. package name and version match the manifest.
43. Every required package script exists in the checked-out package.
44. The dependency-lock name and version match the package.
45. `lockfileVersion` is supported and at least 2.
46. The bootstrap evidence root is an object with the expected runner identity.
47. The bootstrap evidence database and source filename are exact.
48. The verified backup reference and verified backup SHA-256 are valid.
49. The bootstrap operator and bootstrap change reference are valid.
50. Bootstrap start and completion timestamps are canonical, ordered, and bootstrap completion must precede release freeze.

These are 50 meaningful release-semantic controls. Failure of any one invalidates the release candidate.

## Sanitized post-freeze verifier environment

The child source verifier uses a sanitized allowlisted environment. It may inherit only basic path, home, locale, temporary-directory and CI identity values. It must not inherit `NODE_OPTIONS`, `NODE_PATH`, `BASH_ENV`, `ENV`, `CDPATH`, `GIT_DIR`, `GIT_WORK_TREE`, `NPM_CONFIG_PREFIX` or `NPM_CONFIG_USERCONFIG`.

The child environment forces:

```text
PREVIEW_APP_ROOT=<exact checkout root>
DB_NAME=kloka_talk2me
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild
NODE_ENV=production
ALLOW_PRODUCTION_MUTATION=false
ENABLE_CUSTOMER_MERGE_EXECUTION=false
```

The verifier runs with shell execution disabled, a 30-second timeout, forced `SIGKILL` termination and hidden-window execution.

## Post-freeze manifest verification

Run immediately after freeze from the same checkout:

```bash
RELEASE_COMMIT_SHA=<exact-40-character-git-sha> \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
RELEASE_MANIFEST_PATH=/absolute/private/canonical/path/talk2me-release-manifest.json \
node release-manifest-verification.js
```

Verification securely reopens the manifest pair, package files, bootstrap source, bootstrap evidence pair, migrations directory and every migration. It uses canonical paths, `O_DIRECTORY`, `O_NOFOLLOW`, pathname/descriptor identity checks, ownership checks, private evidence permissions, single-link enforcement, bounded reads and byte-count stability.

The migration directory identity is captured before inventory enumeration and rechecked afterwards. Evidence and migration checksums use constant-time comparison where applicable.

## Evidence retained

- Exact commit SHA, branch and version
- CI source inventory and approved digest
- Package and dependency-lock checksums
- Backup reference and backup SHA-256
- Bootstrap source and execution evidence pair
- Migration inventory and checksums
- Preview-data and restore evidence
- UAT evidence
- Private release manifest and sidecar
- Successful post-freeze verification output

## Change control after freeze

Any code, migration, package, lockfile, bootstrap source, bootstrap evidence, backup, restore evidence, configuration or governance change invalidates the candidate. A new commit and complete evidence cycle are required.

## Production protection

This runbook applies only to `talk2me.kloka.co.za` and `kloka_talk2me`. It must not deploy, migrate, restart or modify `talk2me.uent.co.za`.

## Current blocker

The branch does not yet contain a reviewed `package-lock.json`. The release gate therefore remains intentionally blocked. The migration-ledger bootstrap, migration 025 application, preview data verification, deployment, restart and formal UAT have not yet been executed.
