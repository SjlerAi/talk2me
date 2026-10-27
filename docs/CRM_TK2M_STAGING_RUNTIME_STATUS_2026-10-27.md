# TK2M CRM staging runtime — verified implementation status

**Date:** 27 October 2026 (Africa/Johannesburg)  
**Operational state:** **PRIVATE LOCAL SMOKE TEST RUNNING — NOT PUBLICLY DEPLOYED, NOT CUT OVER**  
**New target URL:** https://crm.tk2m.co.za  
**Old live CRM:** https://uent.co.za/talk2me  
**Zippy:** https://zippy.tk2m.co.za

## Verified source and target
- New hosting account: `talk`, server `cp47-jhb.za-dns.com`.
- Current UENT CRM remains live: `uent_Crm`, exact source release `ec582d8245579446d469f02cd26d63a0f8d5e207`.
- Complete non-final source snapshot restored in `talk_crm_stage`: 80 InnoDB tables, 3 working views, baseline clients 3,393, accounts 2,652, staff 14, tasks 215, import rows 4,332, duplicate-triage 188 of which 57 pending. All 49 active private upload files restored into the isolated private staging tree. Test-only staging changes do not affect source and are never promoted as live data.
- `https://crm.tk2m.co.za/` returns 403 under current protected static holding root; `/login` on the public hostname is **not** yet a working CRM deployment.
- Zippy still reports online and remains pointed at old UENT CRM. No CRM bridge cutover was attempted.

## Reviewed staging code
- Branch `feature/tk2m-crm-stage-safe-runtime-20261027`, PR #246, merged via passing GitHub Actions CI into `prep/crm-tk2m-subdomain-20261027` on exact SHA `ccd55cec3a7ba8d6f4a96c2abd526002d85900df`.
- Staging checkout: `/home/talk/repositories/talk2me-crm-stage`. Node 20.20.2 with locked production runtime dependencies; dependency lock unchanged. Git checkout lives outside web root with owner-only permissions.
- Private host-only runtime config: `/home/talk/crm-migration/staging-runtime.env`, mode 0600, contains dedicated `talk_crmstg` credentials and new session secret. **Do not commit, print, or copy to public root.**
- App requires `CRM_STAGE_MODE=true` with `UAT_MODE=true`, exact `talk_crm_stage` DB identity, specific private upload root, secure session cookies, canonical root app URL and email/management outbound flags disabled. The old UENT UAT database guard remains unchanged.
- Stage app binds **127.0.0.1:37421**, not any public interface. It does not schedule deadline or nightly logout workers, and it does not register the live Zippy signed bridge route.
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
