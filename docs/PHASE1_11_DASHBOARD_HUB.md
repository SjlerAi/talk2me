# Talk2Me Phase 1.11 - Dashboard Hub Cleanup

This patch removes the separate Back Office entry point from the owner navigation and makes the Dashboard the operating hub.

## Changes

- Removed the Back Office link from the top navigation.
- Removed the Back Office button from the Dashboard hero.
- Dashboard now includes:
  - Live Activity with clickable case rows.
  - Open Cases / Follow-ups panel.
  - Today by Category panel.
  - Owner workflow note.
- Case detail now opens under `/dashboard/inquiries/:id`.
- Old `/backoffice` URL redirects to Dashboard so existing links do not break.
- Old `/backoffice/inquiries/:id` URLs redirect to the new Dashboard case view.

## Install

1. Upload/extract over `public_html/talk2me`.
2. No SQL migration needed.
3. Restart the Node.js app.
