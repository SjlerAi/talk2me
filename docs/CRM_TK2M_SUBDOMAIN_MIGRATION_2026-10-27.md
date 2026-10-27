# Talk2Me CRM: permanent crm.tk2m.co.za migration gate
**Prepared:** 27 October 2026 (Africa/Johannesburg)  
**Authority:** Owner's current domain instruction supersedes the apex-domain target described in the 24 October 2026 documents.  
**State:** Preparation branch only. **NOT CUT OVER.** Do not claim the production CRM/database have moved.

## Final addresses and ownership
- **Canonical CRM:** https://crm.tk2m.co.za/ ; staff login at https://crm.tk2m.co.za/login .
- **Parent / account domain:** tk2m.co.za ; never place MySQL dumps, credentials, private uploads or raw customer exports in the public web root.
- **Zippy:** https://zippy.tk2m.co.za/ ; independent application and database. Preserve it; reconnect its signed CRM bridge only after production verification.
- **Current working office CRM:** https://uent.co.za/talk2me/login ; retain service until a tested cutover.
- **cPanel target:** hosting account `talk`, on `cp47-jhb.za-dns.com`. Owner's 27 Oct cPanel screenshot confirms creation of subdomain `crm.tk2m.co.za` with document root `/home/talk/crm.tk2m.co.za`. This is a web directory, **not** evidence that the Node CRM or its database have been installed.
- Keep the existing UENT `uent` hosting account and `talk` target account distinct. Separate account means a *verified logical database migration* is likely required; changing APP_URL alone is insufficient.

## Verified remote read-only evidence
- Early 27 Oct, public DNS resolution for `crm.tk2m.co.za` failed. New cPanel registration may precede DNS publication/propagation. Re-test authoritative DNS and TLS; do not treat the earlier failure as permanent.
- At the earlier probe, HTTPS `tk2m.co.za/` returned 200 and an HTML Talk to Me landing page, and `zippy.tk2m.co.za/` returned 200 with a Zippy HTML page. This proves HTTP reachability only, not end-to-end CRM/Zippy functionality.
- `https://uent.co.za/talk2me/api/health` returned 200, `status=ok`, `database=connected`, `environment=uat`. Release endpoint returned commit `ec582d8245579446d469f02cd26d63a0f8d5e207` deployed 22 Oct 2026. Existing `https://talk2me.uent.co.za/api/health` returned 404, so do not assume its data is authoritative.
- The connected Desktop Commander device was operating as Linux user `kloka`, with no visibility into `/home/talk` or `/home/uent`; later device calls timed out. Host inspection/installation requires an authorised live connection running as `talk` (and read-only access to source `uent`), or an authenticated Work/browser/cPanel session. Never try to bypass cPanel account isolation.
- `prep/tk2m-domain-20261024` is a code preparation branch, not a deployed release. The cleaned-data-related branch `uat/duplicate-safe-cleanup-integration-20261023` is upstream of the UI integration branch, but a Git branch does **not** establish how many duplicates were merged in the live database.

## Verified code blockers to address before production activation
1. Current UAT runtime has `BASE_PATH=/talk2me`, `UAT_MODE=true`, private UAT upload paths, disabled outbound. `src/config/db.js` hard-stops if UAT is not mapped to its restricted `uent_Crm` DB/user. **Do not circumvent the guard**. Target production needs its own production config and safety test.
2. `server.js` mounts calendar productivity, work widgets, library, command centre, client visibility, ViralCo sync and management intelligence only inside `if (UAT_MODE)`. Setting `UAT_MODE=false` without extracting and hardening these features **removes staff functionality**. Move approved features behind explicit production-safe feature gates; keep temporary cleanup/debug tools restricted.
3. `src/routes/zippy-integration.js` rejects any connection unless UAT mode and reads its signed bridge secret from `/home/uent/.zippy-t2m-uat-bridge-key`. Production needs a separately secured, private, rotated bridge key path under the correct account, an explicit production enable gate, and signed request + nonce + role tests. Do not copy the old key into a public folder.
4. `server.js` starts deadline and nightly logout background jobs at app startup. Never launch a test/second instance pointed at a writable live database. Add and validate fail-closed staging worker suppression.
5. `server.js` already supports `BASE_PATH=/`; verify login, assets, root redirect, PWA/service-worker scope, deep links, notification links, uploads, session cookies, return-to and redirects.
6. 24 Oct security audit flagged historically committed credentials in an application `.htaccess`, login hardening, CSRF/rate limiting/MFA gaps. Verify remediations and rotate exposed secrets through private host procedures. **Do not deploy tracked .htaccess unreviewed.**

## DNS/TLS and application preparation: no customer writes
1. In `talk` cPanel Domains/Zone Editor verify one `crm.tk2m.co.za` vhost and correct DNS A/AAAA records to the authorised host (formerly 164.160.91.40). Do not touch apex, `www`, `zippy`, or mail MX/SPF/DKIM/DMARC records. Avoid duplicate cPanel domain ownership.
2. Issue and verify trusted AutoSSL for `crm.tk2m.co.za`, then force HTTPS. Verify redirects and certificate trust from an external network.
3. Until ready, show a controlled static **maintenance/coming-soon page** or deny all access; disable directory listing and access to private files. The owner's request for a fresh/blank CRM entry screen refers to a clean login/landing surface, **not a blank database**.
4. Provision the single target Node/Passenger app securely for `talk` (Node runtime, app root, document root, private file root, logs, least-privilege permissions, secrets outside Git/webroot). Do not copy the UAT `.htaccess` or `.env` verbatim.
5. Prepare a *non-writable-to-production* staging installation against an isolated restored DB with outbound emails, WhatsApp, timers, imports, duplicate merges and scheduled jobs disabled.

## Source-of-truth and database migration
1. Compare source `uent_Crm` (current UAT) with legacy `uent_talk2me_crm` and any other production DB using strictly read-only queries. Identify customer/account/phone line IDs, staff, roles, upgrades, tasks, messages, login history, reminders, library documents, imports, changes after 22 Oct, duplicate review decisions, and latest edit timestamps.
2. Record table names, row counts, highest primary keys, schema version, foreign keys, total attachments and paths, and unresolved duplicate/manual-review counts. **Do not assume the previous duplicate cleanup is complete.**
3. Identify the one current system of record based on latest valid staff writes and owner-approved merge decisions. Do not combine datasets casually; do not re-run destructive cleanup scripts on production as part of migration.
4. Take a consistent, complete backup of chosen source MySQL DB, private uploads and nonsecret release config with checksum and timestamp; **restore successfully to isolated staging** and compare counts/relationships, then take a final freeze-time backup for cutover.
5. Create a least-privilege MySQL DB/user in the `talk` cPanel account (cPanel naming may use `talk_` prefix); import the verified source dump privately, outside webroot. Database access should be via localhost/private networking, never a public browsable endpoint such as `https://tk2m.co.za/db`.
6. After verifying backup and restore, freeze writes in the existing CRM, transfer the final delta or fresh dump, compare data and uploaded-file inventories, and activate **one authoritative writable CRM**. Keep the old domain read-only/redirected; do not allow simultaneous production writers.

## Production cutover, testing and rollback
- Promote only a reviewed, exact-SHA CRM build via the existing approved GitHub → CI → deployment control/HOLD process, commissioned for the new `talk` hosting profile; avoid ad hoc deployment and high-resource process restarts.
- Verify `/api/health`, `/api/release`, correct environment and DB identity, secure owner/manager/staff login, owner My Day, customer filters and upgrades, tasks/messages/reminders, account and customer searches, import conflict review, duplicate approval/manual queue, image/Excel/PDF attachments, audit history, mobile/PWA and mail deep links.
- Test Zippy preview/confirm/lookup/updates with a non-production instruction or designated test records only. Confirm its new signed bridge URL, staff authorization, no cross-user access and exactly-once behavior.
- Verify outgoing mail credentials and intended Reply-To with approved test recipients; never enable bulk production sends as a smoke test.
- Monitor resource headroom and logs. Staff cutover only after owner signoff and complete acceptance checks.
- Rollback: prevent new writes, restore routing and previous code, preserve newer data. If a new target DB received writes, reconcile those writes before reverting; **never blindly restore a stale dump and erase valid actions**.

## Current go/no-go checklist
- [x] New subdomain created in target cPanel account, per owner screenshot.
- [x] Existing UENT CRM health and release baseline established.
- [x] GitHub prep branch and blockers identified.
- [ ] DNS and trusted SSL for `crm.tk2m.co.za` verified.
- [ ] Authenticated remote access to `talk` and source data-owner `uent`.
- [ ] Production-ready code/security and protected deployment profile tested.
- [ ] Authoritative cleaned database and remaining manual duplicate counts verified.
- [ ] Complete database/files backup restored and validated.
- [ ] Isolated staging passes functional + permissions tests.
- [ ] Final delta transfer/cutover and Zippy bridge verification complete.
- [ ] Go/no-go approval, live health, exact release SHA, and rollback readiness confirmed.

**Safety invariant:** No actual database copy, code deployment, route switch, DNS change or production credential operation has been performed by this document.
