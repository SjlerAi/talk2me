# Talk2Me CRM v3.2.3 — line and service editing

- Each fixed-service row now has an Edit Service action for owners/managers.
- Staff use the same service form to submit a manager approval request.
- Fixed fields include router, MAC, SIM, package, address, dates, status and technical notes.
- Linked mobile rows now use Edit Line / Request Line Change and Open Line labels.
- Add Fixed Service remains available from Fixed Customer 360.
- No line or service deletion was added. Historical records use lifecycle statuses and remain auditable.

## Deploy

1. Back up the database and application directory.
2. Import `migrations/024_v3_2_3_line_service_editing.sql` into `uent_talk2me_crm`.
3. Upload and extract the release in `public_html/talk2me/`.
4. Set `APP_VERSION=3.2.3` in cPanel if that variable exists.
5. Run `npm install`, then restart the Node.js application.
