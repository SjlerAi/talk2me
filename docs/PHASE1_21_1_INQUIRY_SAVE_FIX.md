# Talk2Me CRM v1.21.1 - Inquiry Save Fix

Fixes the MySQL2 error `Bind parameters must not contain undefined` when saving an inquiry.

Changes:
- Normalises every inquiry bind parameter before database insert.
- Converts blank optional values to SQL NULL.
- Validates that an inquiry category is selected.
- Validates that a client or minimum contact details are present.
- Keeps existing walk-in reporting and client assignment features.

Deployment:
1. Extract over `public_html/talk2me`.
2. Set `APP_VERSION=1.21.1`.
3. Restart the Node.js application.

No SQL migration or npm install required.
