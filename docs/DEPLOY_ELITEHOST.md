# Talk2Me CRM Phase 1 - Elitehost/cPanel Node.js Deploy

## 1. Upload files
Upload this folder to the Node.js app directory for:

https://uent.co.za/talk2me

Recommended folder name:

/home/ACCOUNT/talk2me

## 2. Create `.env`
Copy `.env.example` to `.env` and update:

DB_NAME=uent_talk2me_crm
DB_USER=uent_uent_talk2me_user
DB_PASSWORD=your real database password
BASE_PATH=/talk2me
PORT=3000

## 3. cPanel Node.js app
In cPanel > Setup Node.js App:

- Node version: latest stable available
- Application root: talk2me
- Application URL: uent.co.za/talk2me
- Application startup file: server.js

Then run:

npm install

Restart the app.

## 4. Login details
Default test login works even before password hashes are set:

Owner:
owner@talk2me.local
Talk2Me@2026

Staff:
staff1@talk2me.local
Staff@2026

## 5. Optional password hardening
Import this file in phpMyAdmin after testing:

migrations/005_set_test_password_hashes.sql

## 6. Test flow
1. Login
2. Open Query Popup
3. Search for a real client by cell/name/email/account
4. Select client
5. Choose category
6. Add result and action taken
7. Save
8. Check dashboard activity
