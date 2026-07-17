# Talk2Me Phase 1 Staff Login Update

## What changed

- Staff users now land directly on **New Query** after login.
- Owner/admin/manager users still land on **Dashboard**.
- Staff can log in using the staff name/username instead of email.
- New Query screen has a **Minimize** button.
- When minimized, the query screen docks at the bottom as **Open Talk2Me Query**.

## Import this SQL

Import this file in phpMyAdmin, inside `uent_talk2me_crm`:

```text
migrations/006_add_shop_staff_and_login_flow.sql
```

## Staff test logins

| Staff | Login | Password |
|---|---|---|
| Johnny | johnny | test1 |
| Brabant | brabant | test2 |
| van Zyl | van zyl | test3 |
| Sias | sias | test4 |
| Annazel | annazel | test5 |

Owner login stays:

```text
owner@talk2me.local
Talk2Me@2026
```

## Deployment

Upload this ZIP over the existing files in:

```text
public_html/talk2me
```

Then in cPanel Node.js:

1. Run NPM Install only if package.json changed.
2. Restart App.
3. Test staff login.
