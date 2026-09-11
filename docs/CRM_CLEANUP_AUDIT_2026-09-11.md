# Talk2Me CRM cleanup audit — 11 Sep 2026

This audit is performed after the Base Details integration. The rule is to remove only items proven not to participate in the running Talk2Me `server.js` application or completed one-off operational tooling. Staff-facing business workflows are reviewed separately before retirement.

## Confirmed safe technical cleanup candidates

- Unrelated West Coast Pest workforce-platform entry points and back-office assets bundled in the Talk2Me repository but not loaded by `server.js`.
- `views/client-edit-before-phase2-1.ejs`, an unreferenced pre-Phase-2 backup view.
- Completed one-off Base Details cleanup workflows, which must not be available for accidental rerun.

## Active items requiring business review before any removal

- Current Talk2Me route bundle and staff-facing views.
- Legacy claim/reconciliation functions still registered by `server.js`.
- Layered command/OS CSS and JavaScript still loaded by current views.
- Login fallback behaviour for accounts without password hashes.

No customer data or production schema is changed by this audit document.
