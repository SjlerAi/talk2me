# TK2M live CRM — screen-by-screen acceptance register
**Audit opened:** 17 November 2026 (SAST)  
**Production:** https://crm.tk2m.co.za  
**Verified deployed starting SHA:** `0daba41ea4199396a5298e9d8cc99204e9a97e1f`  
**Safety:** Operational CRM; no customer data changes, test account creation, UENT deployment or database migration.

## Scope and evidence
Read-only production-source scan found **90 EJS screen/partial templates**, with **90/90 EJS syntax compilation passes**. Source inventory found **170 distinct statically declared GET route signatures** plus routes declared using path variables/arrays. Historical usage audit (aggregate only) showed **634 successful screen views** by **8 distinct staff accounts** over 14 days and **27 screen keys**. These counts do not establish visual, role-based or workflow acceptance.

Static navigation scan of 53 constant template links initially flagged two false positives: `/backoffice/office-tools` uses a named route constant, and `/my-command-centre` is inside an array-valued route. Both are declared in source. A separate **genuine defect** remains: the legacy `/backoffice-old` route references the missing `backoffice.ejs` template. It is not among recently observed successful screen views. Do not silently treat it as a working page; resolve through a separately reviewed compatibility redirect.

## Confirmed priority screen groups

| Screen group | Source / static review | Production data or health | Role-specific visual & click acceptance | Notes |
| --- | --- | --- | --- | --- |
| Login and session | Compiles | Production and protected redirects verified | Pending | Confirm Owner/Manager/Staff and expiry |
| My Day / workspace / launcher | Compiles | Observed usage | Pending | Preserve calendar-first functionality while separating testing flags |
| Global customer search | Synthetics passed earlier | Read-only live Owner/Manager/Staff search URL shapes passed | Pending | Use customer opening evidence; no screen accepted merely from route output |
| Customer 360 / mobile base | Compiles | Owner screenshot confirms a customer record opens | **Failed:** false UAT banner still visible | Fix iframe document separately, not just outer layout |
| Fixed account details / services | Compiles | Observed usage | Pending | Desktop and mobile, role permissions |
| Customer Centre / filtering / assignment | Compiles | Observed usage | Pending | Sorting, filtering and multiple valid lines |
| Grouped upgrade / duplicates / line review | Compiles | Heavily used in audit | Pending | No merges or data edits during visual review |
| Black Friday allocation | Compiles | Observed usage | Pending | Staff allocations, visibility and approvals |
| Tasks, chat and notifications | Compiles | Observed usage | Pending | Check opened/read/replied/completed audit |
| Command Centre / approvals | Compiles | Observed usage | Pending | Check management rights and approval navigation |
| Back Office / staff / attendance | Compiles | Observed usage | Pending | Legacy `/backoffice-old` view missing |
| Reporting / Office Intelligence / exports | Compiles | Limited observed usage | Pending | Read-only report/export review |
| Office Email, Word and Excel | Compiles | Observed usage | Pending | Do **not** send real email in a smoke test |
| Master register / service review / imports | Compiles | Observed usage | Pending | Do not change customer lines |
| Library / Deals / other utilities | Compiles | Limited observed usage | Pending | Legacy route names may remain for compatibility; no TEST labels live |
| Zippy and signed CRM integration | Existing security contract passed in prior deployment | Server bridge health not newly end-to-end tested | Pending | Do not test sending without recipient approval |

## Production bug queue
- **UI-001** — Customer iframe continues to show burgundy `TALK2ME UAT / TEST — NOT LIVE` after live-only CSS/layout fixes. The string originates in `public/uat-safety.css`. Unlike the parent OS, an iframe has its own document and own CSS; the parent layout cannot remove the child pseudo-element. New, narrow production-only fix in this branch removes that legacy style from **same-origin** iframe documents on each iframe load; no UENT changes or customer writes. GitHub CI, deployed SHA and actual owner browser acceptance required.
- **UI-002** — `res.locals.isStaging=TK2M_SITE` also evaluates true on production; some screens use it for both redesigned calendar functionality and TEST visual identity. **Do not change the boolean globally** without a parity matrix for My Day and mobile; separately refactor production identity from feature toggles.
- **UI-003** — Historical `/backoffice-old` route renders non-existent `backoffice.ejs`. Needs separate compatibility redirect and role smoke test.
- **SEC-004** — Usage audit normalisation masks numeric path segments but not all encoded service-key identifiers; some recorded screen paths can retain a customer number. Plan a separate privacy-safe normalisation regression and avoid publishing raw paths.

## Acceptance standard
For each active screen: verify actual URL and host, correct TK2M LIVE identity, desktop/mobile layout, no false UAT banner, Owner/Manager/Staff visibility, navigation and back-button behaviour, read-only customer display, task/message state display, error states, and related feature parity. Mark individually: Planned → Developed → Tested → Merged → Deployed/verified → Owner-accepted. Do not claim all screens passed until each relevant user role and browser workflow was observed.

## Deployment gate
Use Deployment Bible V2.1 exact-SHA production control on `deploy/tk2m-crm-control`, existing poller/driver, protected backup, public release read-back, and return to HOLD. Historical UENT system and staging controls remain untouched.
