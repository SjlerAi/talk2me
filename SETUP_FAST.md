# Talk2Me Phase 1 - Fast Elitehost Setup

## 1. Upload
Upload this ZIP contents into:

`/home/uent/public_html/talk2me`

Make sure `server.js`, `package.json`, `.env`, `src`, `views` and `public` are directly inside `/talk2me`.

## 2. Edit `.env`
Only change this line first:

`DB_PASSWORD=REPLACE_WITH_YOUR_DATABASE_PASSWORD`

Use the password you created for MySQL user:

`uent_uent_talk2me_user`

## 3. cPanel Node.js App
Create Node.js app:

- Node.js version: 20.x or 18.x
- Application mode: Production
- Application root: `public_html/talk2me`
- Application URL: `talk2me`
- Application startup file: `server.js`

Then click **Run NPM Install**.

## 4. Restart
Click **Restart App**.

Open:

`https://uent.co.za/talk2me`

## 5. Test login

Owner:

`owner@talk2me.local`

`Talk2Me@2026`

Staff:

`staff1@talk2me.local`

`Staff@2026`

## 6. Optional password hash migration
After the app opens, import this file in phpMyAdmin:

`migrations/005_set_test_password_hashes.sql`

