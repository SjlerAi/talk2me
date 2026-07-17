# Talk2Me CRM v1.18.0 — Prospects and Client Database Management

## Added
- Unknown telephone/email enquiries are clearly marked as **Not in database yet**.
- Staff can tick **Save this person as a potential client** while logging the inquiry.
- Potential clients are stored in the main `clients` table with `lifecycle_status='prospect'`.
- The inquiry is automatically linked to the new potential-client record.
- Owner/admin/manager can add, open and edit full client records.
- Client records support lifecycle and lead status, contact details, town, birthday, ID, package, handset, invoice amount, upgrade/cancellation dates and notes.
- Prospects can later be changed to `client` when converted.

## Install
1. Extract the flat ZIP over `public_html/talk2me`.
2. Import `migrations/016_prospect_client_database_management.sql`.
3. Set `APP_VERSION=1.18.0`.
4. Restart the Node.js application and hard refresh.
