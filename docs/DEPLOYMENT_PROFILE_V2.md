# Talk2Me UI UAT Deployment Profile V2

**Authority:** [Deployment Bible V2.0](DEPLOYMENT_BIBLE_V2_2026-08-22.md). This profile supplies Talk2Me UI-UAT values only; it does not amend the locked architecture.

## Locked UI-UAT profile

| Setting | Talk2Me UI-UAT value |
| --- | --- |
| Repository | `SjlerAi/talk2me` |
| Integration branch | `uat/talk2me-ui-redesign` |
| Controlled release pattern | `release/<description>` |
| Hosted UAT URL | `https://uent.co.za/talk2me` |
| Application root | `/home/uent/public_html/talk2me` |
| Dedicated deployment checkout | `/home/uent/repositories/talk2me-ui-uat` |
| Installed poller | `/home/uent/bin/talk2me-ui-uat-agent` |
| Installed deploy driver | `/home/uent/bin/talk2me-deploy-ui-uat` |
| Deployment state/log root | `/home/uent/.talk2me-ui-uat-deploy` |
| Control checkout | `/home/uent/talk2me-ui-uat-deploy-control` |
| Control branch | `deploy/ui-uat-control` |
| Control manifest | `deploy/ui-uat.json` |
| Poll schedule | Every minute |
| Release endpoint | `https://uent.co.za/talk2me/api/release` |
| Health endpoint | `https://uent.co.za/talk2me/api/health` |
| UAT widget health | `https://uent.co.za/talk2me/api/uat/widgets/health` |
| Agent runtime proof | `https://uent.co.za/talk2me/agent/login` |
| Backup root | `/home/uent/deployment-backups/talk2me-ui-uat` |
| Allowed actions | `hold`, `deploy` |
| Database changes | Never part of routine deployment |
| Production boundary | `main` / production remain untouched without separate owner authorization |

## Routine release path

Feature/fix branch → PR/CI → merge to `uat/talk2me-ui-redesign` → exact `release/*` branch → `deploy/ui-uat-control` request → permanent host poller → local exact-SHA fetch/activation → public SHA + affected-runtime proof → HOLD → owner UAT.

Routine deployment must not use GitHub Actions SSH/SCP, FTP, manual uploads, cPanel file reconstruction, or a second transport.

## Shared-host resource headroom

The Elitehost UAT account has a tight per-user PID/thread budget shared by Passenger applications and remote tooling. Desktop Commander 0.2.x defaults each Node process to a 16-thread libuv pool, so the normal `npx ... remote` launcher can consume most of the available headroom before Talk2Me handles office traffic.

For persistent remote access on `cp47-jhb.za-dns.com`, use the commissioned lightweight launcher:

`/home/uent/bin/desktop-commander-remote-low`

It sets `UV_THREADPOOL_SIZE=2`, avoids the persistent `npm exec` parent process, and reduces V8 worker threads. Routine UI-UAT deployment must refuse to start when the user thread count exceeds the safe pre-deploy threshold, and must verify post-deploy headroom before reporting COMPLETE.

This resource guard is part of the deployment road: do not bypass it by manually restarting Passenger or by running the high-thread `npx @wonderwhy-er/desktop-commander ... remote` process during office-hours deployment.

## Dependency rule

The commissioned UI-UAT deploy driver preserves the existing host `node_modules` and requires the active and requested `package-lock.json` hashes to match. A dependency-lock change is a separate maintenance/commissioning event and must not be improvised during product deployment.

## Current Gerda release

Controlled release branch: `release/talk2me-ui-uat-2026-09-18-gerda-daily-responsibility`

Approved application SHA before poller-layer repair: `5ba23c99d5a871743fc545a3f0e4f5842559cbb8`

The poller-layer repair itself must be merged and commissioned through the Bible before routine release signalling resumes. Hosted success is not claimed until the public release endpoint reports the exact requested SHA and the Agent runtime proof passes.
