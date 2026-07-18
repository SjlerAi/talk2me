# Talk2Me Command 4.0.4

## Corrected

- Updating an existing client assignment now reuses the durable assignment row instead of attempting a duplicate insert.
- Customer assignment changes no longer fail on `uq_client_assignments_client`.
- Work-panel links and forms retain `panel=1`, preventing a second work panel from opening inside the first.
- Add Mobile Line and Add Fixed Service keep the user inside the active work panel.

No database migration is required for this release.
