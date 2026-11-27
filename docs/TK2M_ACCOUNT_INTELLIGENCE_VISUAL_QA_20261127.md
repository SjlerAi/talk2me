# TK2M Account Intelligence — screen-by-screen visual QA register
**Date:** 27 November 2026 (Africa/Johannesburg)  
**Feature:** Draft [PR #351](https://github.com/SjlerAi/talk2me/pull/351) on `feat/tk2m-account-intelligence-20261127`  
**Environment:** Authorised Lenovo Windows machine; Microsoft Edge, actual repository Express routes/EJS templates, actual TK2M layout and assets; `http://127.0.0.1:38187`, bound to loopback **only**. **Synthetic in-memory database** and synthetic PDFs only.  
**Release state:** **LOCAL QA ONLY; NOT MERGED, MIGRATED, DEPLOYED OR OWNER-ACCEPTED.**

## Required quality gate — standing owner instruction

A code check, passing CI run, committed PR or visual mock-up is **not** evidence that a CRM screen works. Before offering any new or changed screen for staff/owner acceptance, the developer must **open every affected screen in an actual browser**, inspect the entire page, click every workflow, validate navigation, error/empty/success states and real role enforcement; repeat at standard desktop, TK2M ~970px split-window and narrow/phone viewport. Fix every discovered problem, reopen and retest the affected screen, rerun all route and regression tests, record verified screenshots and pass/fail evidence. If any screen cannot be opened or tested, explicitly mark it **UNVERIFIED**, not ready. Preserve the Deployment Bible V2.1 production permission, migration and HOLD gates.

## Visual browser QA — actual observed screen states (isolated synthetic fixture)

| Screen / state opened | Actions actually observed | Outcome | Evidence |
| --- | --- | --- | --- |
| Administration Centre / Customers & CRM Data | Opened native TK2M sidebar/header; scrolled to Account Intelligence tile; clicked tile into module | **PASS** synthetic actual Edge | [970px dashboard](./TK2M_AI_QA_970PX_DASHBOARD_20261127.jpg) |
| Account Intelligence empty owner workspace | Opened actual page with zero documents; verified file chooser, account/month and document register sections | **PASS** | [Mobile upload view](./TK2M_AI_QA_MOBILE_UPLOAD_20261127.jpg) |
| Document upload success | Selected `synthetic-statement.pdf` through Windows native picker; clicked Upload & extract, saw saved notice | **PASS** | Browser observed; reference charges below |
| Billing comparison | Opened 2026-10 versus 2026-11: R217.29 / R290.00 / +R72.71; credits R10, payments R220, net R280 | **PASS** | [970px dashboard](./TK2M_AI_QA_970PX_DASHBOARD_20261127.jpg) |
| Second account comparison | Selected B0000002 through live dropdown; clicked Compare; actual page changed to R100 / R130 / +R30 | **PASS** | [Second account](./TK2M_AI_QA_SECOND_ACCOUNT_20261127.jpg) |
| Top-ten detail and review | Inspected full table; entered synthetic explanatory note; selected Verified; clicked Save review and saw acknowledgement | **PASS** | [Mobile review after fix](./TK2M_AI_QA_MOBILE_REVIEW_20261127.jpg) |
| Full CRM snapshot | Visually inspected mobile line costs, fixed/internet service, imported event, 28-day upgrade eligibility and outstanding follow-up | **PASS** on synthetic data | Browser observed |
| Original source PDF download | Clicked actual View PDF document link; browser download activity observed; route matrix checked filename and `nosniff` | **PASS** | Browser observed |
| Client report preview | Clicked Preview (not sent); new tab opened; checked totals, two differences, verified reason, mobile lines, fixed service and future work | **PASS** synthetic | [Customer draft](./TK2M_AI_QA_CLIENT_REPORT_20261127.jpg) |
| Report print workflow | Clicked Print / Save PDF; Edge print preview displayed a 2-page report, then cancelled; nothing sent/printed | **PASS** preview only | Browser observed |
| Missing-schema warning | Forced synthetic schema-not-ready state, opened actual screen; no upload possible and warning clearly displayed | **PASS** fail closed | Browser observed |
| Fake PDF error | Chose spoofed `.pdf` using native Windows picker; clicked upload; saw correct `The file is not a supported PDF` notice | **PASS** | Browser observed |
| No-transaction month | Opened 2025-03 versus 2025-04 for a synthetically populated account; saw zeros and explicit no-differences notice | **PASS** | Browser observed |
| Manager access | Signed in using synthetic Manager session and opened management screen | **PASS** (role fixture) | Browser observed before full layout refresh; HTTP matrix repeats with real route |
| Staff permission denial | Signed in synthetic Staff; opened module URL; actual themed Forbidden page displayed, no module data | **PASS** | [Staff denial](./TK2M_AI_QA_STAFF_DENIED_20261127.jpg) |
| Desktop TK2M split-window | Resized Edge to 970px; header/sidebar adapted and top-ten review remained usable | **PASS** | [970px dashboard](./TK2M_AI_QA_970PX_DASHBOARD_20261127.jpg) |
| Phone/narrow TK2M shell | Resized Edge to near phone width; inspected upload, compare, top-ten cards and preview | **PASS after two defects were fixed and reopened** | [Mobile upload](./TK2M_AI_QA_MOBILE_UPLOAD_20261127.jpg), [Mobile review](./TK2M_AI_QA_MOBILE_REVIEW_20261127.jpg) |

## Defects discovered by *opening* screens (not by static/unit tests)

1. **Mobile top-ten review failure**: horizontal overflow clipped the explanatory text box and Save review button. Corrected with CSS stacked card presentation, labels and fully visible controls; retested visually, **PASS**.
2. **Mobile upload/compare failure inside actual TK2M shell**: min-width grid left both form panels side-by-side and cramped the native file selector. Corrected `.ai-grid` to a single column at width <=720px and gave file input full width; reopened/retested visually, **PASS**.
3. **Downloaded source filename**: an original `.pdf` acquired duplicate `.pdf.pdf` extension. Corrected download naming; validated by HTTP matrix and actual browser download, **PASS**.
4. **QA harness defects only**: corrected in-memory fake SQL duplicate detection, HTTP redirect cookie handling and test form encoding. These never touched production code or customer data.

## Automated end-to-end route coverage

`node scripts/qa-account-intelligence-http-matrix.js` (against actual loopback Express feature routes and synthetic DB): **26 / 26 PASS**, covering:
- Owner empty screen, Manager allowed, Staff denied module/source/client preview
- Missing/invalid CSRF and verified reason validation
- Missing migration fails closed
- Genuine PDF, `.jsp`-named PDF, spoofed PDF, no-account PDF, duplicate file
- Two different account uploads and month comparisons
- Invoice / credit / payment separation, true top-10 differential
- Supporting invoice not double-counted
- Verified reason stored and included only after approval
- Source document download filename and secure response header
- Exceeding six files and exceeding 8 MB rejected
- Failed uploads do not mutate synthetic documents or reviews.

Separate parser regression: **4/4 PASS**, synthetic PDF byte extraction regression: **2/2 PASS**; strict existing blue/red theme regression: **PASS (15 full-document templates)**. GitHub PR CI includes all these checks and the existing CRM `npm run check` suite.

## Explicit limitations / unverified release gates

**DO NOT describe this as ready for live use.** This QA proves route, form and browser behavior with synthetic fixtures only. Still **UNVERIFIED** against:
- Actual live/rehearsal database schema, permissions, migrations, retention and original secure upload filesystem/backups
- Owner-authorised representative real statement and detailed supplier invoice samples, historic line matching, billing variants and exact reconciliation
- The real authenticated Owner, Manager and Staff users/records (rather than QA session fixtures), and real cPanel/Passenger host deployment
- Edge/phone Safari/Android device engines, screen readers, complex print pagination and file recovery
- Screens elsewhere in the established CRM: the existing ~94 legacy EJS templates were covered by structural/regression CI, **not all manually opened in this focused feature QA**.
- Existing production dependency vulnerabilities and unproven source-to-CRM historical change-event accuracy.

**NEXT UNPROVEN GATE:** safe isolated database + permission and real representative PDF verification, then full deployment-specific role, desktop/mobile and screen-by-screen acceptance. Production DB migration, feature merge and release remain owner approval checkpoints under Deployment Bible V2.1. Live CRM has not been modified and no customer communication sent.
