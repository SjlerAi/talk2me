# Talk2Me CRM v1.23.0 — Smart Birthdays

## What it does
- Reads the first six digits of every valid 13-digit South African ID number as YYMMDD.
- Corrects the central `clients.birthday` value from the ID number.
- Records every changed value in `birthday_corrections` before updating it.
- Automatically derives birthday whenever a client is added or edited.
- Auto-fills the Birthday field on the client form as the ID number is entered.
- Adds `/backoffice/reports/birthday-corrections` for owner/admin review.

## Century rule
Using the current year as the pivot:
- a two-digit year greater than the current year's last two digits is treated as 19YY;
- otherwise it is treated as 20YY.

## Installation
1. Extract the flat ZIP over `public_html/talk2me`.
2. Import `migrations/017_birthday_from_sa_id.sql` in phpMyAdmin.
3. Set `APP_VERSION=1.23.0`.
4. Restart the Node.js app and hard refresh.
