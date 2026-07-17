# Talk2Me CRM v1.17.0

## Added

- Assign a client/account to a responsible staff member in Back Office → Clients.
- 06:00 staff work digest: overdue tasks, tasks due today and open follow-ups due today.
- 06:05 owner daily brief: today's birthdays, today's upgrades, overdue work and open cases.
- 08:00 staff client digest: birthdays today and upgrades in the next seven days for assigned clients.
- Branded action emails with direct links into Talk2Me.
- Delivery log and duplicate prevention in `daily_email_log`.
- Digest preferences foundation per staff member.

## Install

1. Extract the flat ZIP over `public_html/talk2me`.
2. Import `migrations/015_client_assignments_daily_digests.sql`.
3. Set `APP_VERSION=1.17.0` and `TZ=Africa/Johannesburg`.
4. Restart the Node.js application.

## Cron jobs

Use the Node virtual environment binary directly:

```cron
0 6 * * * /home/uent/nodevenv/public_html/talk2me/20/bin/node /home/uent/public_html/talk2me/scripts/send-staff-work-digest.js >> /home/uent/public_html/talk2me/digest.log 2>&1
5 6 * * * /home/uent/nodevenv/public_html/talk2me/20/bin/node /home/uent/public_html/talk2me/scripts/send-owner-daily-brief.js >> /home/uent/public_html/talk2me/digest.log 2>&1
0 8 * * * /home/uent/nodevenv/public_html/talk2me/20/bin/node /home/uent/public_html/talk2me/scripts/send-staff-client-digest.js >> /home/uent/public_html/talk2me/digest.log 2>&1
```

The server timezone and application timezone must be Africa/Johannesburg. Each digest is protected against duplicate delivery for the same recipient, date and scheduled slot.

## Manual test

From cPanel Terminal:

```bash
source /home/uent/nodevenv/public_html/talk2me/20/bin/activate
cd ~/public_html/talk2me
node scripts/send-staff-work-digest.js
node scripts/send-owner-daily-brief.js
node scripts/send-staff-client-digest.js
```

Client opportunity emails are only sent after clients have been assigned to staff in Back Office → Clients.
