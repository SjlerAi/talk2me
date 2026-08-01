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

## Mandatory preflight

Run from `/home/kloka/repositories/talk2me/os2-preview`:

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run verify:preview-activation-preflight
```

The preflight must run these source-only controls in this exact order:

1. `workspace-topology-verification.js`
2. `runtime-release-identity-check.js`
3. `readiness-check.js`
4. `deployment-check.js`
5. `uat-gate-check.js`
6. `release-manifest-check.js`

Stop immediately if any control cannot start, is interrupted, or returns a non-zero status.

## Workspace topology verification

Before any other activation control, the workspace verifier must prove that the executing directory is the configured preview application root.

It must:

- reject a missing, relative, non-normalized, or mismatched `PREVIEW_APP_ROOT`;
- validate the application root and migrations directory as real non-symlink directories;
- open directory descriptors with `O_DIRECTORY | O_NOFOLLOW`;
- compare path and descriptor device/inode identities;
- reject group-writable or world-writable protected paths;
- require protected source files to share the preview root owner;
- reject symbolic links and additional hard links for `package.json`, an existing `package-lock.json`, and all migration files;
- require at least 25 ordered migration files and explicit migration 025 presence;
- re-check directory identity after migration inventory validation.

A missing `package-lock.json` is reported during this source-preparation stage but remains a release-freeze blocker. Once the lockfile exists, it must pass the same ownership, permissions, symlink, and hard-link controls.

## Preflight limitations

A successful preflight does not mean that dependencies have been installed, `package-lock.json` exists, migrations have been applied, preview data verification has passed, the application has been restarted, smoke testing has passed, or formal UAT has started.

## Secure release-evidence verification

After a release manifest has been frozen, post-freeze verification must use `release-manifest-verification.js` with the exact commit SHA, controlled branch, and absolute canonical manifest path.

The verifier must:

- reject symbolic links for the evidence directory and protected files;
- require private evidence-file mode `0600` on Linux;
- open protected files with `O_NOFOLLOW`;
- compare the validated path device/inode identity with the opened descriptor;
- read through the validated descriptor rather than reopening by path;
- enforce bounded file sizes before reading;
- verify the manifest checksum using constant-time comparison;
- bind `package.json`, `package-lock.json`, and every migration to the frozen manifest.

Example post-freeze verification:

```bash
RELEASE_COMMIT_SHA=<exact-40-character-sha> \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
RELEASE_MANIFEST_PATH=/absolute/private/canonical/path/release-manifest.json \
node release-manifest-verification.js
```

Stop when `O_NOFOLLOW` is unavailable, the path identity changes during secure open, permissions are incorrect, a protected file exceeds its size limit, or any checksum differs.

## Activation sequence after preflight

1. Confirm the checkout is on the controlled branch and intended commit.
2. Generate and commit `package-lock.json` using a trusted Node.js 20 environment.
3. Repeat workspace topology verification so the committed lockfile is included.
4. Run `npm ci` from the committed lockfile.
5. Run `npm run check` and retain the complete output.
6. Back up and verify `kloka_talk2me`.
7. Apply migrations only with `ALLOW_PREVIEW_MIGRATIONS=true` and `DB_NAME=kloka_talk2me`.
8. Run `DB_NAME=kloka_talk2me npm run verify:preview-data`.
9. Freeze and securely verify the release manifest against the exact checkout.
10. Restart only the preview Node.js application.
11. Run technical smoke testing.
12. Start formal UAT only after all previous stages pass.

## Hard stop conditions

Do not proceed when:

- `PREVIEW_APP_ROOT` is missing or differs from `/home/kloka/repositories/talk2me/os2-preview`;
- the preview root or migrations directory is a symbolic link, changes identity, or is group/world writable;
- protected source files have inconsistent ownership, symbolic links, or additional hard links;
- `DB_NAME` is not exactly `kloka_talk2me`;
- Node.js is not 20.x;
- the branch is not `agent/talk2me-os2-integrated-rebuild`;
- `ALLOW_PRODUCTION_MUTATION=true`;
- `ENABLE_CUSTOMER_MERGE_EXECUTION=true`;
- `package-lock.json` is absent before release freeze;
- preview backup or restore evidence is missing;
- migration or schema verification fails;
- secure release-evidence verification fails;
- the exact deployed commit cannot be proven.

Migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.
