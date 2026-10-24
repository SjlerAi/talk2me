# Talk2Me CRM -> tk2m.co.za: pre-cutover readiness and execution runbook
**Prepared:** 24 October 2026 (Africa/Johannesburg)  
**Status:** PREPARATION ONLY - NOT APPROVED FOR CUTOVER  
**Scope:** Existing Talk2Me CRM; Zippy is a separate product and its CRM bridge must be re-pointed separately.  
**Hard stop:** Do not redirect DNS, alter application base paths, promote a database, enable outbound sends, or switch traffic until the owner confirms the domain is resolved and explicitly authorizes cutover.

## Verified baseline (read-only inspection, 24 Oct)
- Repository: `SjlerAi/talk2me`; integration branch `uat/talk2me-ui-redesign`.
- Current UAT URL: `https://uent.co.za/talk2me`. Hosted folder: `/home/uent/public_html/talk2me`. The public `/api/health` endpoint returned `status=ok`, `database=connected`, `environment=uat`.
- Current UAT deployed SHA: `ec582d8245579446d469f02cd26d63a0f8d5e207`; deployed on 22 Oct 2026 under `release/zippy-v2-signed-lookup-20261022`. The integration branch tip `3320a838fd4ae26ef1a2b97c9cc2a70dcf715c47` is 10 commits ahead (Zippy files). **Do not deploy the branch tip automatically.**
- UAT active Passenger configuration: `BASE_PATH=/talk2me`, `APP_URL=https://uent.co.za/talk2me`, `UAT_MODE=true`, `OUTBOUND_EMAIL_ENABLED=false`, `SESSION_SECURE=true`, separate UAT private uploads. The UAT DB guard in `src/config/db.js` requires database `uent_Crm` and the UAT-specific DB user. Health succeeds in UAT mode.
- An older UAT `.env` carries a different database name from the active Passenger config. **Resolve/remove the conflicting stale values securely before a new deployment**; do not override the UAT guard casually.
- Existing separate legacy production folder: `/home/uent/talk2me.uent.co.za`, configured with `BASE_PATH=/`, `DB_NAME=uent_talk2me_crm`, and private uploads at `/home/uent/talk2me_private_uploads`. Its `/api/health` endpoint was not confirmed (404 during this inspection). **Do not infer that its dataset is the current system of record.**
- UAT external upload directories include library, management, messages, tasks, and work-dispatch. A code/deployment backup dated 22 Oct was found; recent database snapshot existence, completeness, and restorability for cutover remain UNVERIFIED.
- Standalone Zippy at `zippy.uent.co.za` uses a separate database and currently has a CRM URL set to `https://uent.co.za/talk2me`. Zippy 3 is also developed separately. Do not migrate Zippy user records into the CRM database.
- Security gate: review committed configuration for embedded credentials. Rotate any potentially exposed database, SMTP, and session credentials using a private host-side process; remove live credentials from version-controlled files, account for Git history, and do not place secrets in this runbook or chat.

## Target design
- Canonical CRM URL: `https://tk2m.co.za/` (login at `/login`). Redirect `https://www.tk2m.co.za/` to apex after verification.
- Keep CRM on the current hosting account initially; changing domains does not inherently require a new server or a database copy.
- Preserve a single canonical, writable CRM database. Choose the authoritative dataset **after** read-only record-count, freshness, schema, account ownership, attachment, and duplicate-review audit of UAT vs existing production. Never overwrite either dataset with the other without explicit signoff.
- `BASE_PATH=/` and `APP_URL=https://tk2m.co.za` are the intended new runtime values, supplied privately on host. The main server and layout already support a root base path, but comprehensive route/assets/email tests are still required.
- Use a separate Passenger application root for a staging rehearsal **only against an isolated staging DB**. Do not start a second writable app against live data; the CRM server starts periodic background work at startup and duplicate workers could cause duplicate actions.
- Continue using the locked GitHub -> CI -> controlled release SHA -> control manifest -> existing host poller/driver -> public SHA proof -> HOLD deployment procedure (Deployment Bible V2). Commission new host/domain integration through an explicitly reviewed V2 profile; do not introduce an improvised second deployment mechanism.
- Keep Zippy standalone; after CRM cutover, update the selected live Zippy CRM bridge URL and verify signed/authenticated requests. Current bridge implementation is UAT-mode-gated: a production promotion needs a reviewed production-safe bridge plan rather than simply turning `UAT_MODE` off.

## Before DNS resolution: safe preparation
1. Freeze and document the authoritative CRM release SHA, existing deployment profile, hosted application paths, current DB mapping, upload locations, and cron/scheduler inventory. Do not interrupt live staff sessions.
2. Produce a complete, consistent backup of the authoritative database and private-upload directories at an agreed safe window. Retain checksums and verify an isolated restoration. Back up host runtime config separately in a secure location; never commit secrets.
3. Audit UAT and production schemas and record changes using read-only queries. Reconcile customer/client records, staff/roles, messages/tasks, upgrade dates, monthly imports, attachments, approvals, audit logs, and recent edits. Resolve dataset choice before moving traffic.
4. Audit paths and code/templates for host-specific URLs, `/talk2me` prefixes, email task links, static assets, PWA/service worker scope, redirects, CORS/cookie settings, webhook endpoints, and Zippy bridge configuration. Implement/validate fixes on an isolated feature branch.
5. Verify scheduler and outbound suppression in any test installation. No bulk messaging, scheduled emails, imports, duplicate merges, or background dispatches against a live database during rehearsal.
6. Prepare a DNS change plan: A/AAAA records for `tk2m.co.za` and `www`, TTL, intended hosting IP, and TLS certificate provisioning. Preserve MX and existing mail records; plan SPF, DKIM and DMARC if mail will use `@tk2m.co.za`.
7. Prepare an owner-approved maintenance/cutover window, a tested rollback procedure, and a named go/no-go checklist.

## Cutover gates (ONLY after owner approval and DNS resolution)
1. Confirm apex and www DNS resolve to intended hosting, domain is mapped in cPanel/Passenger, HTTPS certificates are valid, and mail DNS remains correct.
2. Provision the reviewed target app/root and secure runtime settings. Confirm the exact version of Node, dependencies, environment variables, DB identity and storage path. Do not move test uploads into legacy production blindly.
3. Test an isolated staging copy with OUTBOUND emails and jobs off. Confirm landing page, sign-in and RBAC for owner/manager/staff, customer search and save, calendars/My Day, filters/upgrades, tasks, notifications, library/deals documents, monthly import conflict preview, duplicate approval workflow, Zippy bridge and mobile/PWA service-worker behavior. No real customer sends/edits in staging.
4. Announce short maintenance, stop/lock writes and scheduled jobs, capture a fresh atomic database + private-files backup (checksum and restore check), record release SHA and DB binlog/point-in-time marker where available.
5. Activate the exact approved release using the V2 deployment road. Point **one** writable CRM application at the approved canonical database. Validate `/api/health`, `/api/release` exact SHA, login, attachment open/upload, create/update/read verification on a controlled test record, role permissions, outgoing email to approved test recipients, and logs.
6. Reconfigure the signed Zippy/CRM integration URL after its security gates pass; verify only the approved operations.
7. Allow staff into the new domain, monitor resource headroom and critical routes, confirm mail links and Reply-To behavior, then put the old URL behind a tested redirect or read-only holding page. Preserve old URL paths where possible and avoid concurrent active writers.
8. Restore the deployment control manifest to HOLD and verify exact live SHA and health. Only then declare the migration complete.

## Mailbox-specific gate
The CRM domain and its email delivery are separate DNS concerns. Before sending as `gerda@tk2m.co.za`, verify that mailbox authentication, MX, SPF, DKIM, DMARC, sender address, and the owner's required Reply-To destination work in real end-to-end tests. Do not make UAT bulk outbound-live by accident.

## Rollback rules
- Keep the previous hosted application/code and its route available until post-cutover verification passes.
- If both domains only ever referenced the **same canonical database**, roll back routing/application configuration; **do not restore an old database dump** and thereby erase newer valid writes.
- If data has actually been migrated between databases, stop new writes and use a pre-agreed point-in-time recovery/reconciliation plan. Restore a backup only after proving no newer authoritative records would be lost.
- On failed health, SHA, database, login, uploads, SSL, session, background-work or security gates: STOP, preserve logs/state, prevent duplicate writes, restore prior routing and release through the locked process, and verify HOLD.

## Explicitly outstanding
- Domain DNS and SSL (owner says not yet resolved).
- Authority of UAT vs existing production data, read-only row counts, latest edit timestamps, schema parity and target DB choice.
- Full recoverable and verified database/files backup immediately before cutover.
- Review and remediation of source-controlled secrets and conflicting stale host configuration.
- cPanel new-domain mapping, final Passenger root, root-route regression, mail records, Zippy bridge production readiness.
- Owner authorization to switch; without it, this remains preparation only.
