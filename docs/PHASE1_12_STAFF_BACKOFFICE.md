# Talk2Me CRM Phase 1.12

## Included
- Login screen version stamp: Version 1.12.0 / Build 2026-07-10
- Back Office landing page
- Staff listing
- Owner/admin/manager/staff access levels
- Create and edit staff profiles
- Activate/deactivate staff logins
- Password reset
- Private profile photo and ID document upload
- Basic owner client administration search

## Installation
1. Upload and extract the patch over `public_html/talk2me`.
2. Import `migrations/011_staff_backoffice_foundation.sql` in phpMyAdmin.
3. Run **NPM Install** because `multer` was added.
4. Add the cPanel environment variable:
   - `APP_VERSION=1.12.0`
   - `APP_BUILD=2026-07-10`
   - Optional: `PRIVATE_UPLOAD_DIR=/home/uent/talk2me_private_uploads`
5. Restart the Node.js application.

Private documents are served only through authenticated owner/admin/manager routes. They are not placed in the public web folder.
