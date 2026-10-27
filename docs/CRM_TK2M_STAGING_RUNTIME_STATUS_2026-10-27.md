# TK2M CRM staging runtime — verified implementation status

**Date:** 27 October 2026 (Africa/Johannesburg)  
**Operational state:** **PASSWORD-PROTECTED STAGING WEBSITE RUNNING — NO PRODUCTION CUTOVER**  
**New target URL:** https://crm.tk2m.co.za  
**Old live CRM:** https://uent.co.za/talk2me  
**Zippy:** https://zippy.tk2m.co.za

## Verified source and target
- New hosting account: `talk`, server `cp47-jhb.za-dns.com`.
- Current UENT CRM remains live: `uent_Crm`, exact source release `ec582d8245579446d469f02cd26d63a0f8d5e207`.
- Complete non-final source snapshot restored in `talk_crm_stage`: 80 InnoDB tables, 3 working views, baseline clients 3,393, accounts 2,652, staff 14, tasks 215, import rows 4,332, duplicate-triage 188 of which 57 pending. All 49 active private upload files restored into the isolated private staging tree. Test-only staging changes do not affect source and are never promoted as live data.
- `https://crm.tk2m.co.za/login` is now served by the separate CloudLinux Node.js app and protected by cPanel Directory Privacy. Unauthenticated requests return HTTP 401. Authenticated preview test requests return HTTP 200 for login, health, release, My Day widgets and library health. This is a staging preview, not production cutover.
- Zippy still reports online and remains pointed at old UENT CRM. No CRM bridge cutover was attempted.

## Reviewed staging code
- Branch `feature/tk2m-crm-stage-safe-runtime-20261027`, PR #246, merged via passing GitHub Actions CI into `prep/crm-tk2m-subdomain-20261027` on exact SHA `ccd55cec3a7ba8d6f4a96c2abd526002d85900df`.
- Staging checkout: `/home/talk/repositories/talk2me-crm-stage`. Node 20.20.2 with locked production runtime dependencies; dependency lock unchanged. Git checkout lives outside web root with owner-only permissions.
- Private host-only runtime config: `/home/talk/crm-migration/staging-runtime.env`, mode 0600, contains dedicated `talk_crmstg` credentials and new session secret. **Do not commit, print, or copy to public root.**
- App requires `CRM_STAGE_MODE=true` with `UAT_MODE=true`, exact `talk_crm_stage` DB identity, specific private upload root, secure session cookies, canonical root app URL and email/management outbound flags disabled. The old UENT UAT database guard remains unchanged.
- Staging smoke was first run on **127.0.0.1:37421**. The reviewed CloudLinux Passenger wrapper now runs the staging app at **https://crm.tk2m.co.za** behind HTTP Basic preview protection. Its staging runtime still disables deadline/nightly logout workers, outbound communication and the live Zippy signed bridge route.
- Local `/api/release` reports reviewed SHA `ccd55cec3a7ba8d6f4a96c2abd526002d85900df`, source branch `prep/crm-tk2m-subdomain-20261027`, `environment=staging`, and `publiclyDeployed=false`.
- Local `/api/health`, `/login`, `/api/uat/widgets/health`, `/api/uat/library/health`, `/api/productivity/health`, `/api/uat/telemetry/health` all responded 200.
- Unauthenticated `/workspace`, `/dashboard`, `/calendar`, `/command-centre`, `/api/scratchpad` redirect to login. Staging `POST /api/integrations/zippy/preview` returns 404, so the existing Zippy cannot talk to test data.
- Local code-level validator `scripts/validate-tk2m-staging-safety.js` passes fail-closed cases. Selected existing regression tests also pass: owner My Day bootstrap, library, customer filters, task inbox, mobile-first, Zippy signed bridge signatures.
- GitHub workflow `Validate Talk2Me` for PR #246 completed **successfully**.

## Remaining before a staff-visible protected preview
1. **One-time cPanel/CloudLinux Passenger commissioning under the approved Deployment Bible V2 route**. The `talk` account's `uapi PassengerApps list_applications` currently returns permission error `You do not have the feature “passengerapps”.` Existing Zippy was commissioned separately with CloudLinux Passenger; do not presume that the standard cPanel UAPI can manage the new CRM app.
2. Provide a validated Node startup entrypoint that loads the *private staging environment* and review the exact Passenger bind and Node runtime behavior. Avoid enabling a duplicate automated deployment transport. Register a dedicated V2 deployment profile/poller/driver/control manifest for TK2M before routine public releases.
3. Enable an additional **password-protected preview gate** (Directory Privacy/HTTP Basic with private credential storage) before attaching Passenger to the public CRM vhost. Preserve Let's Encrypt HTTP-01/AutoSSL challenge paths. Verify unauthenticated requests return 401/403 and that no sensitive uploads, dumps, logs or configuration are publicly served. Never remove the current quarantine before a tested access gate.
4. Complete an authenticated owner and staff role acceptance test with authorized test credentials; login page GET and logged-out redirects alone do not prove My Day, tasks, views, search, safe edits, files, staff claims and role security end-to-end.
5. Audit security: known historical source-controlled secrets, CSRF, request throttling, privileged MFA, secure uploads and cookies, outbound integrity, app permissions. Reconcile feature gates before choosing `UAT_MODE=false` for eventual production.
6. Repeat data and upload transfer under a final scheduled write freeze after acceptance; do not use the non-final test snapshot as production data.
7. Only after owner cutover approval update Zippy's signed bridge URL and direct CRM DB mapping, and enforce a single writable CRM system of record.

**Do not claim the new CRM is accessible to staff. Do not point Zippy to stage. Do not touch the UENT release or run staging jobs against the UENT database.**


## Additional checkpoint — staging application registered and verified on CRM.TK2M (27 Oct)
- Owner provided screenshots confirming **Setup Node.js App** is available in `talk`, with only the existing Zippy Node 22 application initially listed.
- cPanel UAPI `DirectoryPrivacy` now reports `crm.tk2m.co.za` directory as **protected=1, auth_type=Basic**. A dedicated `tk2m_preview` user was provisioned; its strong generated password is in `/home/talk/crm-migration/staging-preview-password.json` (mode 0600, not Git or chat). Owners can use cPanel **Directory Privacy** to reset/create their own preview password without sharing it in ChatGPT.
- Anonymous access to `/login`, `/api/health`, and representative asset URLs returns **HTTP 401**. Authorized preview requests successfully reached the CRM application. cPanel `.htaccess` retains `Options -Indexes` and `Require valid-user`; all runtime secrets and DB dumps remain outside public webroots.
- PR [#247](https://github.com/SjlerAi/talk2me/pull/247) passed GitHub Actions validation and was merged to `prep/crm-tk2m-subdomain-20261027` at **`ad82a9b0f62da4aefe7a2b426c31dcc2c04afa10`**.
- Added `passenger-staging.js` with exact private staging env-file requirement, staging safety assertion and host-config access-mode check. Listener logic supports CloudLinux Passenger while binding explicit numeric staging test ports to loopback.
- Registered **separate CloudLinux Selector app** (Node **20.20.2**, root `repositories/talk2me-crm-stage`, domain `crm.tk2m.co.za`, startup `passenger-staging.js`, app status **started**). No edits or restarts to Zippy (`repositories/zippy3`, Node 22.23.4).
- Authorized HTTPS smoke: `/` and `/login` responded 200, `/api/health` 200 with `environment=staging`, `database=connected`; `/api/release` 200 with approved SHA; `/api/uat/widgets/health`, `/api/uat/library/health`, `/api/productivity/health` all 200; `/api/integrations/zippy/preview` 404 (staging bridge unregistered).
- Post-registration live checks: existing UENT CRM healthy and Zippy online; CRM staging unauthenticated login 401, SSL valid; the two CloudLinux applications are both started.
- **No real-user login/role regression has been performed**; authenticated HTTP Basic is NOT the same as an authenticated CRM staff session. Gerda/Johnny must test their own CRM logins and workflows in a browser. The copied data is for rehearsals only and must be replaced by a fresh cutover-time snapshot after approval.

## Remaining release gates
1. Let owner and designated staff retrieve or set the **extra cPanel Directory Privacy** preview credentials, then sign in with their usual CRM accounts. Test owner My Day, staff roles, customer filters, imports, duplicate reviews, tasks/messages, attachments, mobile UX and deep-link return.
2. Before allowing meaningful task actions, verify staged outbound remains disabled and all background timers remain stopped. Never point Zippy at staging.
3. Commission the dedicated protected **Deployment Bible V2** control/poller for routine future deployments under `talk`; this one-time CloudLinux application registration is not authority for ad hoc release-by-manual-copy.
4. Audit new SSL challenge/renewal compatibility with directory privacy and the production-grade login/session/CSRF/MFA/role controls.
5. After staff acceptance, plan write freeze, fresh full source DB/uploads backup, checksum-verified production DB restore, exact SHA deploy, linked Zippy bridge change, and rollback readiness. **Owner approval is required for final cutover.**


## 27 October — owner-directed historical work cleanup, safe duplicate pilot, and Cudu static fix

**Source versus target boundary:** The owner asked to remove tasks/messages through **26 October 2026 inclusive** and consolidate only demonstrably safe customer matches. All destructive or consolidating operations below were executed against **`talk_crm_stage`**, never against working `uent_Crm`. Staff continue working on UENT.

**Rollback:** Before any write, a consistent complete staging SQL dump of **80 tables and 3 views** was created and verified, with private manifest and SHA-256 under `/home/talk/crm-migration/backups/20261027T040847Z-talk_crm_stage-before-cleanup.sql.gz`. Original active private uploads remain isolated and backed up. The audit logs and scripts are owner-only under `/home/talk/crm-migration/audits/`.

**Historical work purge cutoff:** `created_at < '2026-10-27 00:00:00'` (the full 26 October included), with deletion of task-linked records before task parents. The transaction removed: 215 staff tasks, 12 chat messages, 175 comments, 132 task notifications, 93 task workflow rows, 15 agent watches, 12 chat read rows, 2 task attachment rows, 1 work dispatch, 53 outdated Zippy bridge drafts, 536 management notification events, and 3 personal calendar items. All targeted tables were checked at 0 remaining rows immediately after cleanup. `staff_users`, customer records, contracts, imports, files, notes, `audit_log`, `daily_email_log`, and inbound management mailbox records were **not** purged.

**Safe consolidation:** Of 131 prior auto-grouped duplicate candidates, a strict read-only classifier found 2 fully matching groups after verifying account ID/number, phone, identity/name, email, package, upgrade-date history, assigned staff and mobile source. 125 groups have conflicting next-upgrade dates, 2 conflicting previous-upgrade dates and 2 no longer contain two active customers. Exactly **2 high-confidence pairs** were archived in a single audited staging transaction: no customer rows deleted, one redundant staff allocation deactivated, two audit events logged without impersonating staff. The source customer's 3,393 total records remained, with active rows **3,205 on UENT** and **3,203 on staging**. Remaining repeated-active-phone groups on staging are **184**: 129 unverified auto-grouped and 55 pending-manual-review phone groups. A separate total of 57 pending identity review records exists in the cleanup queue. Other matches (48 ID-number groups, account masters, same emails and contract-date conflicts) remain unmerged. Do not treat category totals as disjoint customer counts.

**Cudu fix (PRs #248–#251):** Retired its EJS loading points, old quick command panel and API on TK2M. Owner screenshot still showed the launcher. An authenticated HTTPS test proved that the *actual static* `/public/js/cudo-widget.js` response could still serve the old mascot loader despite Express middleware interception. PR [#251](https://github.com/SjlerAi/talk2me/pull/251), approved by CI and deployed in the private staging profile at SHA `38c4edf4e2bd32bfe5d74eb9468d777388f1f0f4`, added the TK2M hostname guard to the **static asset itself**. Verified HTTPS response 200 with guard before launcher-creation code, CSS guard active, health 200, release identity correct, and anonymous login 401 with trusted TLS. A previously loaded browser tab must be closed/reopened to release old DOM/cache. The old UENT Cudu remains unchanged.

**Post-cleanup data checks:** `uent_Crm`: 3,393 customers (3,205 active), 215 tasks, 12 chat messages, 175 task comments, 536 notification events; no staging-safe-merge audit events. `talk_crm_stage`: 3,393 customers (3,203 active), 0 tasks, 0 messages, 0 task comments, 0 notification events, two staging-safe-merge audit events. Both sites' health remained OK; Zippy continues pointing at UENT.

**Code/feature usage audit (read-only UENT):** The 11 September code audit listed safe *technical* cleanup candidates (unrelated platform entry points, old backup EJS view, completed one-off routines) but said to retain registered staff modules pending usage proof. The UENT code release includes `usageMiddleware()`, `/api/usage/events`, `crm_usage_events` and Office Intelligence. The live ledger has **2,397 events since 5 October**, last recorded 26 October 16:20, from 8 distinct staff: 1,576 screen views, 414 HTTP actions, 272 feature opens, 111 logins, 7 tracked logouts, 16 task opens, and 1 explicitly tracked task creation. Office Intelligence has 81 runs. Last 14 days heavily reflect cleanup/testing rather than routine office operations: 613 temporary cleanup module events, 378 back office, 186 customers, 152 workspace, 73 attendance, 32 fixed, 14 command centre, 12 approvals, 4 library, 1 calendar. Low counts for embedded single-page modules are **not proof of non-use** because `screen_view` is only emitted for completed server HTML GETs; embedded tab opens need client-side `feature_open` coverage. More instrumentation and role-separated 7/14/30-day reporting should precede removal of unused UI.

### Critical final-cutover retention rule
**Do not deploy the cleaned staging database as production data** and do not lose real UENT edits made after its source snapshot. At approved cutover: freeze old CRM writes, take a fresh full backup, restore to the dedicated production DB, then, after confirming user intent and exact date cutoff, run a rehearsed equivalent task/message purge on the *production copy only* with a new backup and transaction audit. Separately replay only the exact-match customer consolidations that pass the same account/identity/date/assignment validations against the fresh source. Reconcile staff edits dated 27 October onward, then connect Zippy and open staff access. Preserve UENT until go-live signoff. Never copy stale staging records over live edits.
