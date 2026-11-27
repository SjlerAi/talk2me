# TK2M — Gerda real-document QA (local only)
**Date:** 27 November 2026 (SAST)
**Project:** TK2M Account Intelligence, [draft PR #351](https://github.com/SjlerAi/talk2me/pull/351)
**Execution:** Authorised Lenovo-i7 desktop, PowerShell/Node.js, real Microsoft Edge forms, actual feature routes and UI; isolated loopback server `127.0.0.1:38189` with in-memory synthetic CRM/database adapter.
**Source:** Gerda's owner-supplied OneDrive Docs folder, 4 local PDF-backed `.jsp` files. **No customer source PDFs or unredacted screenshots are committed, transferred to GitHub or stored in the Space.**

## Actual file-by-file results

| Source filename | Genuine PDF bytes | Dated transactions extracted | Billing periods detected | PDF extraction warnings | Oct–Nov arithmetic | Account page / preview | Original byte-for-byte download |
| --- | --- | ---: | --- | ---: | --- | --- | --- |
| `Econo.jsp` | PASS | 1,150 | May–Nov 2026 | 0 | PASS | PASS / PASS | PASS |
| `Hestony.jsp` | PASS | 1,014 | May–Nov 2026 | 0 | PASS | PASS / PASS | PASS |
| `Knick Knack.jsp` | PASS | 143 | May–Nov 2026 | 0 | PASS | PASS / PASS | PASS |
| `SMS Techn.jsp` | PASS | 2,073 | May–Nov 2026 | 0 | PASS | PASS / PASS | PASS |
| **Total** | **4/4** | **4,380** | **7 months each** | **0** | **4/4** | **4/4** | **4/4** |

Each file had a distinct recognisable account number. Every dated source row was extracted into exactly one transaction row. The source files are read-only and remain unchanged; pre- and post-test SHA-256 prefixes on the Lenovo matched. These tests do not establish that source PDF running balances are sequential or prove supplier ledger correctness independently of source interpretation.

## Real browser / route tests using the four actual sources

- Opened **TK2M Account Intelligence** inside the real TK2M shell and selected all four `.jsp` files in the Windows native multi-file dialog.
- Clicked **Upload & extract**: application reported **4 documents saved, 0 duplicates skipped, no CRM lines changed**, into the **local in-memory QA database only**.
- Account selector / **Compare** button: opened and observed an individual October-versus-November billing position for **each of four different accounts**; all amounts agreed with the separately executed source parsing and integer-cent reconciliation.
- **Top 10** screen with actual transactions: 66, 42, 9 and 17 monetary differences by document respectively; the UI limited display correctly to 10, 10, 9 and 10. Reviewed mobile stacked-card layout with the largest actual document: full reason and Save review fields remained visible.
- Opened a **real-document customer-report preview** in Edge, checked its billing summary, top differences, no verified reasons, and explicitly **unsent** status. Opened **Print / Save PDF** preview and cancelled; no printing or customer communication.
- An automated local-only authenticated HTTP roundtrip then opened each account page and each customer preview, confirmed previous/current invoice totals, downloaded each original source in memory and compared its SHA-256 with the supplied file: **4/4 byte-identical**.
- Re-uploaded the same four files in the QA environment: **all four duplicates skipped; document count remained four, entry count remained 4,380, and four distinct accounts remained separate**.
- Checked synthetic Owner and Manager access and that a synthetic Staff session receives HTTP 403. No real credentials or real CRM identity were used.
- Original-source PDF first page was also opened in Edge for visual column inspection. An exploratory sequential running-balance test was discarded as **not applicable** to the reverse/statement ordering; its mismatches must not be interpreted as actual supplier-balance defects or recorded as a passing financial proof.

## Actual blockers: no production claim

- [Draft PR #351](https://github.com/SjlerAi/talk2me/pull/351) remains **open, draft and unmerged**. The feature route file is **absent from the current PR base branch**. The route and Administration tile are integrated only in the feature branch.
- Read-only navigation to the hosted `https://crm.tk2m.co.za/backoffice/account-intelligence` redirected to **Staff Login**. No authenticated production user session was available. The approved read-only Lenovo portfolio host inspection returned MCP 429, so deployed SHA/schema were **not** independently checked in this pass.
- No production database migration, code deployment, live permission change, live document upload, historical CRM account matching, real user authorization or release has occurred or been claimed. The isolated fake CRM reports **account identity not verified** as expected.
- Actual vendor document **transaction extraction and arithmetic** pass; final independent supplier invoice verification, live account linkage and original billing evidence checks remain **UNVERIFIED**.
- The existing ~94 unrelated CRM legacy screens were **not all manually opened** in this focused module QA, though existing broad CI is passing.

## Final safety / cleanup

The local test listener was stopped, and its **dedicated temporary QA directory** (four private file copies, sample PDF, synthetic fixtures) was removed. All four original OneDrive `.jsp` sources remained present and hash-unchanged. No original real source PDF, raw account data or unredacted customer screenshot was pushed to GitHub or posted in Space.

**Latest QA branch SHA at documentation:** `6a21bbb693a27b980758adb5e15368d613e6e89b` (the final documentation commit is later). [GitHub CI run 45940021227](https://github.com/SjlerAi/talk2me/actions/runs/45940021227) **SUCCESS**, including the 26/26 synthetic end-to-end route tests and existing regressions. Real-document fixture tests ran locally and cannot be part of public/remote CI because customer source files must not be uploaded.

**Release gate:** Follow Deployment Bible V2.1 exactly. Before **any** production merge, schema migration, permission change, deployment or customer-record write, obtain the required separate owner approval and prove current hosted state, backup/integrity and tested rollback. After authorised release, use the four **original files** through the live owner-authenticated UI, verify source hashes, CRM account identity/permissions and all affected screens, record per-file pass/fail and only then invite staff for acceptance. **Current status: LOCAL REAL-DOCUMENT QA PASS; PRODUCTION UNVERIFIED / HOLD / NOT READY FOR STAFF.**
