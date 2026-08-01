# Talk2Me OS2 Preview Activation Runbook

## Purpose

This runbook controls source validation before any deployment, migration, restart, or formal UAT activity for `talk2me.kloka.co.za`.

## Fixed preview identity

- Application: `talk2me-os2-preview`
- Version: `0.59.0`
- Branch: `agent/talk2me-os2-integrated-rebuild`
- Database: `kloka_talk2me`
- Node.js: 20.x
- Production: `talk2me.uent.co.za` must remain untouched
- Customer-merge execution: disabled

## Mandatory preflight

Run from `/home/kloka/repositories/talk2me/os2-preview`:

```bash
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run preflight:preview-activation
```

The preflight must run these source-only controls in this exact order:

1. `runtime-release-identity-check.js`
2. `readiness-check.js`
3. `deployment-check.js`
4. `uat-gate-check.js`
5. `release-manifest-check.js`

Stop immediately if any control cannot start, is interrupted, or returns a non-zero status.

## Preflight limitations

A successful preflight does not mean that:

- dependencies have been installed;
- `package-lock.json` exists or is current;
- migrations have been applied;
- preview database verification has passed;
- the preview application has been restarted;
- technical smoke testing has passed;
- formal UAT has started or passed.

These are separate controlled stages.

## Activation sequence after preflight

1. Confirm the checkout is on the controlled branch and intended commit.
2. Generate and commit `package-lock.json` using a trusted Node.js 20 environment.
3. Run `npm ci` from the committed lockfile.
4. Run `npm run check` and retain the complete output.
5. Back up and verify `kloka_talk2me`.
6. Apply migrations only with `ALLOW_PREVIEW_MIGRATIONS=true` and `DB_NAME=kloka_talk2me`.
7. Run `DB_NAME=kloka_talk2me npm run verify:preview-data`.
8. Restart only the preview Node.js application.
9. Run technical smoke testing.
10. Start formal UAT only after all previous stages pass.

## Hard stop conditions

Do not proceed when any of the following is true:

- `DB_NAME` is not exactly `kloka_talk2me`;
- Node.js is not 20.x;
- the branch is not `agent/talk2me-os2-integrated-rebuild`;
- `ALLOW_PRODUCTION_MUTATION=true`;
- `ENABLE_CUSTOMER_MERGE_EXECUTION=true`;
- `package-lock.json` is absent before release freeze;
- preview backup or restore evidence is missing;
- migration or schema verification fails;
- the exact deployed commit cannot be proven.

Migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.
