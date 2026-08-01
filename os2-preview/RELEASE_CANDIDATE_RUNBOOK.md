# Talk2Me OS2 Preview Release Candidate Runbook

## Purpose

This procedure controls the point at which a development build may be frozen as a preview release candidate. It does not authorise production deployment or customer-merge execution.

## Mandatory prerequisites

1. A reviewed `package-lock.json` is committed.
2. GitHub validation has completed successfully for the exact candidate commit.
3. All preview migrations, including `20260801_025_merge_authorisation_restore_pin.sql`, have been applied to `kloka_talk2me` only.
4. `DB_NAME=kloka_talk2me npm run verify:preview-data` passes against the preview database.
5. The preview data verification must run `schema-verification.js` first and `merge-restore-evidence-verification.js` second.
6. Running only `npm run verify:schema` or only `npm run verify:merge-restore-evidence` is not sufficient release evidence.
7. `npm run check:merge-restore-pin` passes.
8. `npm run check:customer-merge-execution-readiness` confirms that exact restore evidence is pinned and that merge execution remains disabled.
9. Automated preview UAT and the documented manual UAT stages are complete.
10. A verified preview backup exists before the candidate migration or restart.
11. Every merge execution authorisation is linked to the exact passed restore test for the same verified backup, with the restore completed before Owner authorisation.
12. Security, privacy, communications and worker checks have been evidenced.
13. The candidate commit SHA, approver and change reference are recorded.

The preview data verification result must identify database `kloka_talk2me`, both completed verifiers in order, and `mergeExecutionEnabled: false`. Stop the release-candidate process if either verifier fails, is interrupted, or cannot start.

## Required evidence order

Record evidence in this order so later evidence cannot silently replace earlier approval inputs:

1. exact candidate commit and preview version;
2. committed dependency lock and dependency audit result;
3. verified preview backup ID, checksum and database identity;
4. isolated restore-test ID for that backup;
5. successful preview data verification showing schema-first and restore-evidence-second completion;
6. restore-pin and merge-readiness checks;
7. automated and manual UAT evidence;
8. release-candidate manifest;
9. post-freeze manifest checksum verification.

A newer restore test must not be substituted for the restore test pinned to an existing merge authorisation.

## Freeze command

Run from the preview application directory with an absolute private output path:

```bash
RELEASE_COMMIT_SHA=<exact-git-sha> \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
RELEASE_APPROVED_BY=<name> \
RELEASE_CHANGE_REFERENCE=<issue-or-change-reference> \
RELEASE_MANIFEST_PATH=/home/kloka/private/talk2me-release-manifest.json \
npm run check:release-candidate
```

The command must fail when the dependency lock file is absent, required operational evidence is missing, runtime table creation is detected, merge recovery controls are missing, or release metadata is incomplete.

## Post-freeze manifest verification

Immediately after the freeze command succeeds, verify the manifest and its checksum sidecar from the same private path:

```bash
RELEASE_MANIFEST_PATH=/home/kloka/private/talk2me-release-manifest.json \
node release-manifest-verification.js
```

The verification must fail when:

- either evidence file is missing, is a symbolic link or is not a regular file;
- private `0600` permissions are not retained;
- the SHA-256 sidecar format or filename is wrong;
- the manifest bytes no longer match the checksum;
- commit identity, dependency-lock evidence or migration evidence is incomplete;
- migration 025 is not recorded;
- the required preview data verification command or exact verifier order is absent;
- required merge recovery checks are absent;
- `mergeExecutionEnabled` is anything other than `false`.

Retain the successful verification output with the release evidence. Re-run this verification whenever the manifest is copied or retrieved from storage. A failed verification invalidates the candidate until the evidence chain is investigated and recreated.

## Evidence retained

- Exact commit SHA and preview version
- Migration inventory and SHA-256 checksum per migration
- Migration 025 presence and checksum
- Required runbook and validation inventory
- Release approver and change reference
- Warnings and blocking failures
- Private release-manifest JSON
- Release-manifest SHA-256 sidecar
- Successful post-freeze manifest-verification output
- GitHub Actions run URL and build-evidence artifact
- Preview backup ID, database identity and checksum
- Pinned restore-test ID and backup relationship
- Restore environment, restored database, completion time and failed-check count
- `verify:preview-data` output
- Preview data verification order: `schema-verification.js`, then `merge-restore-evidence-verification.js`
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

Migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.
