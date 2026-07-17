# Talk2Me CRM Version 3.0.11

## Purpose

Version 3 turns Talk2Me into a streamlined, role-controlled command system with one universal customer search, dropdown navigation, protected customer changes, approvals and owner audit control.

## Roles

- Staff: customer search, Customer 360, inquiry capture, own tasks/work and proposed changes.
- Manager: the same operational and administrative rights as owner, including protected approvals, but never archive/delete rights.
- Owner: all manager rights plus the final password-protected archive/delete controls.

Every successful login now creates an immutable attendance record. Sessions last a maximum of eight hours, track activity, and record manual logout, timeout, or replacement by a new login.

The active application version and build are displayed at the bottom of every logged-in back-office screen as well as on the login screen.

Staff Management now displays each person's assigned access role directly beneath their name, so Owner, Manager and Staff are immediately visible.

Every authenticated user can send a message or task to any active Staff, Manager or Owner. Each user has an inbox and a Sent by Me view; managers and owners retain the All Staff overview.

Messages and tasks now use an active work queue. Unread, seen and in-progress items remain visible until deliberately completed. Completed or cancelled items move automatically to the searchable Completed Archive; status changes and reopening are recorded in the item history.

Application sessions are now stored persistently in MySQL instead of Node memory. Minimizing or leaving the browser inactive no longer ends the login, and cPanel/Passenger process recycling no longer destroys active sessions. Each login has a fixed maximum duration of eight hours.

## Deployment order

1. Back up the database and `public_html/talk2me`.
2. In phpMyAdmin select `uent_talk2me_crm` and import `migrations/021_v3_0_11_persistent_sessions.sql`.
3. Confirm the green success message and the new `app_sessions` table.
4. Extract the application ZIP directly into `public_html/talk2me`, overwriting matching files.
5. Do not replace or delete `.env`.
6. Restart the Node.js application.
7. Log out and back in so the current role is reloaded.

If cPanel Setup Node.js App contains an `APP_VERSION` environment variable, update it to `3.0.11` before restarting. This ensures the displayed version and browser CSS cache use the same release number.

## Acceptance test

1. Staff: search a client, open Customer 360 and submit a proposed town/email change.
2. Manager: open Approvals and approve ordinary and protected changes.
3. Staff: submit an account number or upgrade-date change.
4. Manager: confirm client/staff administration works but no Archive/Delete control is visible or permitted.
5. Owner: confirm the password-protected Archive control remains available.
6. Log in and out as staff, then confirm the record in Administration → Login & Attendance.
7. Confirm the universal customer search appears on operational pages.
8. Test New Inquiry, tasks, messages, reports and Upgrade Centre.

## Rollback

Restore the backed-up application files. The new approval and audit tables may safely remain; older application code does not use them.
