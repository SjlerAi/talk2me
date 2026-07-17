# Talk2Me Phase 1 - Real Staff Emails Fix

## Install

1. Upload/extract this ZIP over the existing files in:

   public_html/talk2me

2. Import this SQL file in phpMyAdmin while inside database `uent_talk2me_crm`:

   migrations/007_update_staff_real_emails.sql

3. Restart the Node.js app in cPanel.

## Staff Logins

| Staff | Login | Password |
|---|---|---|
| Johnny | jonathan@talk-online.co.za | test1 |
| Sias | sias@talk-online.co.za | test2 |
| Annazel | annazel@talk-online.co.za | test3 |
| Brabant | sales3@talk-online.co.za | test4 |
| van Zyl | sales4@talk-online.co.za | test5 |

The login input is now text-based, not email-only, so usernames can still be used later if needed.
