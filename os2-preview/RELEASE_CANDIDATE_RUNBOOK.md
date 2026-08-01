# Talk2Me OS2 Preview Release Candidate Runbook

## Purpose

This procedure controls the point at which a development build may be frozen as a preview release candidate. It does not authorise production deployment or customer-merge execution.

## Mandatory prerequisites

1. A reviewed `package-lock.json` is committed.
2. GitHub validation has completed successfully for the exact candidate commit.
3. All preview migrations, including `20260801_025_merge_authorisation_restore_pin.sql`, have been applied to `kloka_talk2me` only.
4. `npm run verify:schema` passes against the preview database.
5. `npm run verify:merge-restore-evidence` passes against `kloka_talk2me`.
6. `npm run check:merge-restore-pin` passes.
7. `npm run check:customer-merge-execution-readiness` confirms that exact restore evidence is pinned and that merge execution remains disabled.
8. Automated preview UAT and the documented manual UAT stages are complete.
9. A verified preview backup exists before the candidate migration or restart.
10. Every merge execution authorisation is linked to the exact passed restore test for the same verified backup, with the restore completed before Owner authorisation.
11. Security, privacy, communications and worker checks have been evidenced.
12. The candidate commit SHA, approver and change reference are recorded.

## Required evidence order

Record evidence in this order so later evidence cannot silently replace earlier approval inputs:

1. exact candidate commit and preview version;
2. committed dependency lock and dependency audit result;
3. verified preview backup ID, checksum and database identity;
4. isolated restore-test ID for that backup;
5. successful restore evidence verification;
6. schema verification and migration inventory;
7. automated and manual UAT evidence;
8. release-candidate manifest.

A newer restore test must not be substituted for the restore test pinned to an existing merge authorisation.

## Freeze command

Run from the preview application directory with an absolute private output path:

```bash
RELEASE_COMMIT_SHA=<exact-git-sha> \
RELEASE_APPROVED_BY=<name> \
RELEASE_CHANGE_REFERENCE=<issue-or-change-reference> \
RELEASE_MANIFEST_PATH=/home/kloka/private/talk2me-release-manifest.json \
npm run check:release-candidate
```

The command must fail when the dependency lock file is absent, required operational evidence is missing, runtime table creation is detected, merge recovery controls are missing, or release metadata is incomplete.

## Evidence retained

- Exact commit SHA and preview version
- Migration inventory and SHA-256 checksum per migration
- Migration 025 presence and checksum
- Required runbook and validation inventory
- Release approver and change reference
- Warnings and blocking failures
- Private release-manifest JSON
- GitHub Actions run URL and build-evidence artifact
- Preview backup ID, database identity and checksum
- Pinned restore-test ID and backup relationship
- Restore environment, restored database, completion time and failed-check count
- Schema-verification output
- `verify:merge-restore-evidence` output
- `check:merge-restore-pin` output
- Merge readiness output showing `executionAvailable: false`
- Automated and manual UAT evidence

## Merge execution protection

Release-candidate freeze does not enable customer-merge execution. The release manifest must retain:

```text
mergeExecutionEnabled: false
```

Any future merge execution implementation requires a separate reviewed change, explicit transactional execution controls, rollback evidence and a new release-candidate cycle.

## Change control after freeze

Any code, migration, package, restore evidence or configuration change after candidate freeze invalidates the candidate. A new commit, validation run, backup, restore test, manifest and UAT evidence set is required.

## Production protection

This runbook applies only to `talk2me.kloka.co.za` and database `kloka_talk2me`. It must not be used to deploy, migrate, restart or modify `talk2me.uent.co.za`.

## Current blocker

The branch does not yet contain a generated and reviewed `package-lock.json`. The release-candidate gate is therefore intentionally expected to fail until dependencies are installed in a controlled environment and the resulting lock file is reviewed and committed.

Migration 025, preview schema verification, pinned restore-evidence verification, deployment, restart and formal UAT have not yet been executed.
