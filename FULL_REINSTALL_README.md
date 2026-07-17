# Talk2Me CRM v3.2.6 — clean full reinstall

This archive contains the complete Talk2Me CRM application source needed by cPanel Node.js.

It deliberately excludes:

- `.env` and passwords
- cPanel's generated `.htaccess`
- `node_modules`
- logs, temporary files and uploaded customer documents
- old deployment ZIP files
- unrelated applications

## Safe reinstall

1. Back up `public_html/talk2me` and export the `uent_talk2me_crm` database.
2. Stop the Talk2Me Node.js application in cPanel.
3. In `public_html/talk2me`, keep `.htaccess` and any local `.env` file. Remove the other application files and folders left by the incorrect ZIP.
4. Upload this ZIP into `public_html/talk2me` and extract it there.
5. Confirm `package.json`, `server.js`, `src`, `views`, `public`, `scripts` and `migrations` are directly inside `public_html/talk2me`—not inside another nested folder.
6. In cPanel, confirm the application root is `public_html/talk2me`, the URL is `/talk2me`, and the startup file is `server.js`.
7. Set `APP_VERSION=3.2.6`, save, run npm install once, and restart the application.
8. Open `https://uent.co.za/talk2me/` and hard-refresh the browser.

Do not re-import the database. The reinstall replaces application files only.
