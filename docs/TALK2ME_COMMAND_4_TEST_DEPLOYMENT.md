# Talk2Me Command 4.0.0 — Test Deployment

This is a full application package. It preserves the existing Talk2Me database and existing CRM routes.

## Before deployment

1. Export a full backup of `uent_talk2me_crm` in phpMyAdmin.
2. In cPanel File Manager, compress the current `public_html/talk2me` folder as a rollback copy.
3. Do not delete or re-import the database. Version 4.0.0 requires no database migration.

## Install

1. Stop the Talk2Me Node.js application in cPanel.
2. Open `public_html/talk2me`.
3. Keep the server `.env` or cPanel environment variables. The ZIP intentionally contains no passwords.
4. Extract the full Version 4.0.0 ZIP into `public_html/talk2me` and allow it to replace application files.
5. Confirm the application startup file is `server.js` and Node.js is 20.x.
6. Click **Run NPM Install**.
7. Restart the application.
8. Hard refresh the browser with `Ctrl+F5` and log in again.

## Test checklist

- Login lands on **My Workspace** for staff, manager and owner.
- The left sidebar shows role-appropriate functions.
- Manager/owner can open **Shop Command Centre**.
- Universal customer search finds mobile and fixed records.
- New Inquiry, customer, task and report links open in the full-screen work panel.
- **Close & Return** returns to the same workspace position.
- Enable **Alerts** in the top bar, then send the user a test task/message.
- The message appears and makes a sound while the workspace stays open.
- Existing queries, tasks, fixed services, mobile lines, approvals, reports and administration still open.

## Optional VoIP integration

No VoIP provider URL has been assumed. When the provider supplies its web-dial URL format, add a `VOIP_URL_TEMPLATE` environment variable in cPanel. This avoids hard-coding one provider into the CRM.
