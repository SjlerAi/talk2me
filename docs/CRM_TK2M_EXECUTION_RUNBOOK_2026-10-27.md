# Talk2Me CRM — execution plan for crm.tk2m.co.za

**Prepared:** 27 October 2026 (Africa/Johannesburg)  
**Status:** STAGING PREPARED; SOURCE MIGRATION AND CUTOVER NOT STARTED.  
**Canonical future CRM:** https://crm.tk2m.co.za/login  
**Current office CRM:** https://uent.co.za/talk2me/login  
**Zippy:** https://zippy.tk2m.co.za/  
**Working branch for preparation:** `prep/crm-tk2m-subdomain-20261027`

## Core decision and safety rules
1. Keep the existing UENT CRM writable and in service until a privately tested, exact-release replacement passes acceptance. No live data or staff sessions are changed by setup or rehearsal.
2. Source of truth must be demonstrated with live row counts, edit dates, import history and owner-approved cleanup history. The working application currently reports `environment=uat` but is the one staff use. That UAT label is **not** permission to discard its data.
3. Test with a distinct `talk_crm_stage` database; production will later use a separately provisioned `talk_crm_prod` database. No test process may write into `uent_Crm` or send real emails, WhatsApps, task reminders or customer alerts.
4. Private MySQL dumps, uploads, config and keys remain outside the public document roots. Backup/transfer and key rotation must use private server-side secure channels. Do not put plaintext credentials in Git or the chat.
5. The old and new CRM must **never both accept writes** to diverging production databases. Cutover must include a planned write freeze and release verification.
6. Zippy remains functional throughout. Its signed bridge and direct CRM DB use are switched together only after verifying the new CRM; its personal DB `uent_zippy3` needs a separate, controlled migration if the final goal is to eliminate dependence on UENT.
7. Do not turn on a second CRM scheduler/worker against source data; this app starts background work at startup.
8. Go/no-go for the actual switchover remains an explicit owner decision.

## Verified checkpoint — 27 Oct 2026
| Item | Result |
|---|---|
| Account / host | `talk` on `cp47-jhb.za-dns.com` |
| Future web document root | `/home/talk/crm.tk2m.co.za` |
| DNS | `crm.tk2m.co.za` resolves to `164.160.91.40` |
| HTTPS / SSL | Trusted Let's Encrypt for both crm and www.crm; expires 25 Jan 2027 |
| HTTP redirect | 301 -> HTTPS for crm and www.crm |
| Indexing / raw php config | Directory listing disabled (403); php.ini/.user.ini/.htaccess and cgi-bin inaccessible by HTTP |
| UENT active health | HTTP 200, db connected, environment `uat` |
| UENT installed release | `ec582d8245579446d469f02cd26d63a0f8d5e207` (22 Oct 2026) |
| Target CRM login / health | 404; Node CRM not yet installed |
| Zippy at TK2M | HTTP 200 at /api/health; `status=online`; separate Node 22 app |
| Zippy current bridge | Hard-coded to `https://uent.co.za/talk2me/api/integrations/zippy/` |
| Zippy database dependencies | `uent_zippy3` (personal) and `uent_Crm` (CRM) |
| Target MySQL | `talk_crm_stage` created, **empty**; production DB not created |
| Private migration work root | `/home/talk/crm-migration`, owner-only mode 0700 |
| Source DB access | Read-only metadata/count queries succeeded via existing Zippy connection; direct UENT filesystem and privileged backup access still unavailable |
| MariaDB | 10.11.19; 80 observed InnoDB base tables, 3 views, approximately 70.08 MiB allocated data+indexes |
| Code delta | Preparation branch is 15 commits ahead of running release; do not deploy branch tip automatically |
| Node | Node v20.20.2 and v22.23.4 available; use Node 20 for source-runtime parity unless explicitly validated otherwise |

### Source database row-count baseline (read-only)
As measured at checkpoint (not necessarily final cutover counts):
- `clients` 3,393; `customer_accounts` 2,652; `mobile_base_current` 3,406; `staff_users` 14.
- `staff_tasks` 215; `staff_chat_messages` 12; `audit_log` 2,566.
- `monthly_import_rows`, `monthly_import_matches`, `monthly_import_actions`: each 4,332.
- `temporary_duplicate_triage`: 188, comprising 131 `auto_grouped` and 57 `pending`.
- `temporary_cleanup_decisions` 176, `temporary_cleanup_review_history` 177, `temporary_cleanup_changes` 176.
- Triage rows and decision rows are different entities. **These do not establish a count of physically merged or deleted customer records.**
- Recent `clients` edits observed on 26 Oct 2026. Do not use a stale 22 Oct backup for final cutover.
- Protected evidence manifest stored under `/home/talk/crm-migration/preflight/` and should be used to compare snapshots, not exposed publicly.

## Stage 1 — source ownership, backup and completeness audit
**Owner source account required:** authenticated remote terminal for `uent` (not the `talk` login, which has no access to `/home/uent`).
1. Read-only inspect actual Passenger/runtime config and private upload roots of the working `/home/uent/public_html/talk2me` release; record actual branch/SHA and runtime env *keys* without printing secrets. Determine all cron/Passenger processes, sender paths and source logs.
2. Compare working `uent_Crm` with legacy `uent_talk2me_crm` in read-only mode to confirm source-of-truth. Use highest IDs, latest edit timestamps, import batches, staff activity and approved duplicate-review history. Do not merge databases or execute cleanup during comparison.
3. Inventory **all** private attachments: library, tasks, messages, management, work dispatch, customer files and source exports, including counts, total bytes, checksum manifest and database path references.
4. Run a consistent `InnoDB` source backup using the privileged source account with `--single-transaction --quick --skip-lock-tables` and appropriate schema objects. Verify the 3 views and their definer/grants under new account; include necessary triggers, routines, events and charset settings if present.
5. Store encrypted backups **outside** public web directories with checksums and independent restoration proof; keep a tested rollback copy. Never treat a code ZIP as a database backup.
6. Freeze/reconcile the cleanup audit and record manual review state, including the 57 currently pending triage rows, without re-running a merge or modifying approvals.

**Gate:** complete source database + private uploads inventory, consistent restoreable backup, explicit authoritative dataset and source account access.

## Stage 2 — target data isolation and secure infrastructure
**Already complete:** target domain DNS, HTTPS redirect and no-index security; `talk_crm_stage`; private `/home/talk/crm-migration` directory tree.
1. Create separate least-privilege staging DB user and credentials (private secret file, not command-line history or repository), and verify DB ownership, grants, quota and client version. Avoid using Zippy's credentials for CRM staging.
2. Verify existing web vhost is still quarantined. Provision an isolated Node/Passenger application checkout under `/home/talk/repositories/` and separate app, cache, log and attachment directories. Review generated `.htaccess` rather than copying source host's runtime directives.
3. Ensure the staging environment requires **both** temporary site-level access control and CRM authentication before client data is loaded. Default-deny static access to raw export, uploads, backups, configuration and logs.
4. Import a verified backup into `talk_crm_stage`; reconcile source/target table and view inventory, counts, relationships, indexes, reference files, import batches, audit records and time zones. Fix cross-account `DEFINER` ownership of views only through reviewed SQL.
5. Use a fresh staging session secret and host-only secure cookies; `APP_URL=https://crm.tk2m.co.za`, `BASE_PATH=/`, and staging-safe feature flags. Staging outbound communications and scheduled workers must remain OFF.

**Gate:** staging DB matches its source snapshot; no independent scheduled writes or external sends; no public customer-data exposure.

## Stage 3 — code and security hardening for production
1. Branch from the exact deployed release and integrate only accepted UAT upgrades. The current main CRM source has several operational modules inside `if (UAT_MODE)`; changing UAT to false would disable My Day/calendar, tasks widgets, library, ViralCo, cleanup and Zippy integration. Extract approved features to independent, tested production-safe feature controls, leaving unsafe UAT/debug actions disabled.
2. Create a single reviewed TK2M deployment profile that follows the existing GitHub → CI → controlled release SHA → deploy control → host driver → verify SHA → HOLD rule. Do **not** copy old `uent` deployment pollers, restart active Zippy or use ad hoc scripts against live.
3. Security: remove/rotate historic exposed DB/SMTP/session credentials through private procedures; retire any login fallback; add/test login throttling, MFA for privileged staff, CSRF protection, security headers, session expiry and role-based authorization. Test upload security and access logs for customer data leakage.
4. Refactor Zippy CRM bridge to take a reviewed configurable URL, key path and explicit production allowlist. The existing bridge is UAT-only and uses a UENT key path; maintain signed request, replay protection, staff identity checks and exactly-once task confirmation.
5. Keep all background workers, owner reports, attendance checks, email/SMS/WhatsApp and scheduled reminders gated OFF in staging. A staging health check must never start a production write worker.
6. Check Node v20 runtime parity, package-lock, PWA scope at `/`, cookie domain, service worker, redirect after login, file links, attachment storage and all hardcoded `/talk2me` paths.

**Gate:** reviewed CI tests, security gates and exact release SHA; one staging app processes test requests without affecting UENT.

## Stage 4 — protected staff acceptance testing
Use the new CRM address behind an additional authentication gate until acceptance. Use copied records only; make no real customer sends.
- **Owner, manager, staff:** login, logout, role separation, Gerda's **new** My Day calendar, team overview, owner management, staff activity, attendance, tasks and messaging.
- **Customers:** account search, name/phone/account lookup, multi-line Customer 360, upgrade-month/year and staff filters, assignment, save/reopen/reload, notes, birthdays, client import and daily activity.
- **Duplicate cleanup:** review queue shows same pending vs approved states; approve one designated *test copy*, remove it from queue, preserve an audit record; link after login returns reviewer to intended page. Do not alter real cleanup approvals.
- **Monthly imports:** preserve the 4,332-row sample baseline, display numbered conflicts and resolution choices; finalization only inside staging.
- **Files:** image, PDF and Excel/Deals libraries; search, open, owner-authorized upload/delete and attachment routing.
- **Zippy:** signed task preview → one confirm → CRM message/update, correct user mapping, owner permissions, mobile phone push and reminders. Test without sending real tasks on the live system.
- **Emails:** correct sender/recipient and Reply-To under approved test identities only; check links in emails take staff back to the new domain after login.
- **Reliability:** desktop and mobile, session isolation, PWA cache scope, record integrity, resource headroom, application restart, failed database connection and rollback.
- Ask Gerda and Johnny to approve functional acceptance. The old UENT site remains live throughout.

**Gate:** acceptance recorded, known defects addressed, backup and rollback dress rehearsal pass.

## Stage 5 — final live data transfer / release
This is the **only** stage requiring a controlled write freeze of the old CRM and explicit owner go-ahead.
1. Record final approved production SHA, exact source DB, source file inventory and source timestamps; record a maintenance announcement. Ensure the old UENT CRM and Zippy CRM actions **cannot accept new authoritative writes** while in the transfer window. Keep independent Zippy personal reminders available.
2. Stop/disable **old CRM write workers and email dispatchers** safely through documented controls; do not kill unrelated services. Take a fresh consistent database backup and final checksum inventory of uploads.
3. Restore final approved database and uploads into separately provisioned `talk_crm_prod`, using least-privilege prod credentials and private storage. Restore verified schema objects, assign correct view definer/grants, compare exact row counts, cleanup-review states, highest IDs, recent timestamps, file checksums and referential checks.
4. Promote the approved exact SHA through a new protected production deployment profile, with `BASE_PATH=/`, correct APP_URL, secure host-only cookies, scheduler and outbound allowed only after verification. The newly deployed CRM must be **the only writable production instance**.
5. Verify `/api/health` and `/api/release` SHA and source database identity, owner/manager/staff login, search, one designated test record update, files, My Day, messages, notifications and audit log.
6. Update Zippy's signed API bridge and all direct CRM DB references together with new credentials and allowlists; verify preview/confirm/updates and permissions. Run approved outbound mail tests including Reply-To. Do not move the independent Zippy personal database in the middle of the CRM transaction unless separately rehearsed.
7. Open access to staff; make old UENT URLs read-only or redirect preserving deep-link paths. Clear/PWA cache migration directions and require fresh login at new domain. Confirm no background duplicate writers, then return deployment control to HOLD.

**Gate:** one authoritative writable CRM, completed integration, verified data continuity and staff go-live sign-off.

## Stage 6 — aftercare and Zippy independence
1. Monitor role/login errors, missing attachments, import anomalies, daily workers, tasks, message delivery, duplicate review queue and resource utilization; maintain ready rollback artefacts.
2. In a separate controlled maintenance window, migrate Zippy's **personal** `uent_zippy3` DB into a private `talk` account DB after full backup and restore verification; update only Zippy's own DB config and run login/reminders/push regression tests. This removes the remaining personal-data dependency on the UENT DB account.
3. Rotate stale cross-account credentials and revoke access only after full confirmation. Do not delete UENT data/backups until a separate written retention/decommission decision.

## Rollback
- Before the production switch: stop staging only; existing CRM remains live and unaffected.
- If the new production has **no accepted live writes**: revert traffic to the frozen old app and source DB; verify task and message delivery, restore old worker ownership and alerts.
- If the new production **has accepted any real writes**: prevent further writes and reconcile changes into the chosen authoritative DB before reverting. Never restore an older dump over valid later client edits.
- Restore a failed software release by exact SHA; verify HTTPS, DB identity, files, login and Zippy bridge. Return deployment control to HOLD.

## Current blockers / next executable actions
- [x] DNS/SSL/HTTP redirect/index protection for CRM site
- [x] Public service health of UENT CRM and Zippy
- [x] Source aggregate counts, duplicate review counts and schema metadata
- [x] Isolated `talk_crm_stage` empty DB in target cPanel
- [x] Protected private migration directories and read-only baseline manifest
- [ ] Source `uent` authenticated terminal for privileged complete backup and uploads inventory
- [ ] Complete 80-table + 3-view, consistent source DB and private uploads backup, checksum and **tested** restoration
- [ ] Least-privilege staging DB user and staging runtime credentials
- [ ] Production-safe feature gates, security fixes, worker suppression, bridge refactor and CI
- [ ] Protected staging app installation / owner and staff acceptance
- [ ] Final fresh backup, `talk_crm_prod` restore, approval, exact-release cutover
- [ ] Zippy CRM bridge remap; later personal DB migration and independent confirmation

**Never infer “data migrated” from only a healthy website or from the presence of an empty database.**
