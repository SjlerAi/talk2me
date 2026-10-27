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
