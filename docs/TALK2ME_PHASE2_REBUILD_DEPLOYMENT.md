# Talk2Me CRM Phase 2.0 Rebuild

## What this release changes

- Owner/admin login lands on the new Command Centre.
- Staff login lands on My Workspace.
- Customer 360 answers upgrade, birthday, contact, email, town, handset and line-count questions.
- Account lines are grouped by account number while cellphone remains the line identifier.
- Upgrade Centre reports against all historical client-line data.
- Work Centre shows overdue, due-today, unassigned and all open inquiries.
- Client Administration explicitly labels Next Upgrade and links to Customer 360.
- Upgrade CSV export and print use the selected Upgrade Centre filters.
- Inquiry CSV now respects the selected inquiry filters and reports assigned responsibility.

## Preserved

All existing routes, inquiry capture, Walk-ins, tasks, messages, notifications, emails, digests, staff administration, client editing and reports remain in the application.

## Deployment

The Phase 2.1 database migration has already been run on the live database. It remains included for a clean installation or disaster recovery and is safe to rerun.

Back up `public_html/talk2me` before uploading. Upload the package contents into `public_html/talk2me`, preserving the directory paths. Do not upload `.env` and do not delete existing files that are absent from this package.

Restart the Node.js application after upload.

## Acceptance tests

1. Owner login opens `/command-centre`.
2. Search `0790219426` and open Customer 360.
3. Confirm FREEPAK CC displays its account lines and calculated next upgrade date.
4. Open Upgrade Centre and test Overdue, Today, Next 7 Days and Export CSV.
5. Open Work Centre and test Overdue, Due Today, Unassigned and All Open.
6. Log in as staff and confirm My Workspace opens.
7. Create and resolve a test inquiry.
8. Create and complete a test task.
9. Confirm existing notifications and email sending still operate.

## Rollback

Restore the backed-up application files. The added database columns may remain; old application code ignores them.
