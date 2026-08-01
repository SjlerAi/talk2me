# Talk2Me OS2 Preview Release Candidate Runbook

## Purpose

This procedure controls the point at which a development build may be frozen as a preview release candidate. It does not authorise production deployment.

## Mandatory prerequisites

1. A reviewed `package-lock.json` is committed.
2. GitHub validation has completed successfully for the exact candidate commit.
3. All preview migrations have been applied to `kloka_talk2me` only.
4. `npm run verify:schema` passes against the preview database.
5. Automated preview UAT and the documented manual UAT stages are complete.
6. A verified preview backup exists before the candidate migration or restart.
7. Security, privacy, communications and worker checks have been evidenced.
8. The candidate commit SHA, approver and change reference are recorded.

## Freeze command

Run from the preview application directory with an absolute private output path:

```bash
RELEASE_COMMIT_SHA=<exact-git-sha> \
RELEASE_APPROVED_BY=<name> \
RELEASE_CHANGE_REFERENCE=<issue-or-change-reference> \
RELEASE_MANIFEST_PATH=/home/kloka/private/talk2me-release-manifest.json \
npm run check:release-candidate
```

The command must fail when the dependency lock file is absent, required operational evidence is missing, runtime table creation is detected, or the release metadata is incomplete.

## Evidence retained

- Exact commit SHA and preview version
- Migration inventory and SHA-256 checksum per migration
- Required runbook and validation inventory
- Release approver and change reference
- Warnings and blocking failures
- Private release-manifest JSON
- GitHub Actions run URL and build-evidence artifact
- Preview backup ID and checksum
- Schema-verification output
- Automated and manual UAT evidence

## Change control after freeze

Any code, migration, package or configuration change after candidate freeze invalidates the candidate. A new commit, validation run, backup, manifest and UAT evidence set is required.

## Production protection

This runbook applies only to `talk2me.kloka.co.za` and database `kloka_talk2me`. It must not be used to deploy, migrate, restart or modify `talk2me.uent.co.za`.

## Current blocker

The branch does not yet contain a generated and reviewed `package-lock.json`. The release-candidate gate is therefore intentionally expected to fail until dependencies are installed in a controlled environment and the resulting lock file is reviewed and committed.
