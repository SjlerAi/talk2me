# Zippy live CRM login — Gerda and Stephan

## Supported identities

- Gerda: `gerda@talk-online.co.za`. Existing Zippy private password remains usable; her live Talk2Me owner password can also be used when live CRM authentication is configured.
- Stephan: `info@b4s.co.za`. Authenticates against the **live** Talk2Me CRM bcrypt password hash; Zippy never creates or stores a second password.
- Other CRM staff cannot sign into this two-person rollout.

Both identities have independent `owner_key` values in Zippy's private database. CRM messages use the matching account's **UAT** staff identity and require confirmation. Do not point personal-data queries to the CRM database.

## Authentication connection

Use a dedicated MySQL user with **SELECT only**, limited to the production `staff_users` identity/password verification fields where supported. Never reuse the production application writer, Zippy's personal-database credentials or the UAT CRM database password.

Required private environment variables (never put in GitHub or the public document root):

```dotenv
ZIPPY_CRM_AUTH_HOST=localhost
ZIPPY_CRM_AUTH_PORT=3306
ZIPPY_CRM_AUTH_DATABASE=uent_talk2me_crm
ZIPPY_CRM_AUTH_USER=<readonly_username>
ZIPPY_CRM_AUTH_PASSWORD=<readonly_password>
```

In cPanel, grant no `INSERT`, `UPDATE`, `DELETE`, `CREATE` or `DROP` privileges. Check `SHOW GRANTS` before enabling login. Do not turn on Stephan's login unless this read-only account has been verified against the *live* CRM and the deployment's resource headroom is safe.

The private Zippy app needs `bcryptjs`, `mysql2` and other dependencies installed in its separate Node environment. Starting Zippy executes `bootstrap()` to create the additive `zippy_auth_sessions` table; existing Gerda sessions and reminders must remain intact.

## Safety checks before handing over

1. Gerda's existing Zippy password still signs in; her reminders and contacts remain.
2. Stephan signs in with his **existing live CRM** email and password, without recording his password in a log or the Zippy database.
3. Incorrect passwords and unapproved CRM accounts are rejected without revealing which record exists.
4. Each account can create and view its own reminder, but not the other's records, alerts, contacts, push subscriptions or CRM drafts.
5. Changing a live CRM password invalidates the corresponding CRM-authenticated Zippy session on its next access. Gerda's private-password sessions remain separate.
6. The UAT CRM bridge creates a draft under Stephan's CRM ID when Stephan is signed in and under Gerda's ID when Gerda is signed in. No staff messages are sent without explicit approval.
7. Push subscriptions must be associated with the correct email and the service worker must verify the currently signed-in email before displaying sensitive reminders on a shared device.
8. Zippy and Talk2Me health both remain OK, only one Passenger application process for each, and UI-UAT deployment control returns to HOLD.

## Deployment

Develop and test in GitHub. Deploy standalone Zippy through the existing Node/Passenger application only after staging the read-only account. Deploy UAT CRM bridge changes through the established staggered UI-UAT deployment-control release branch. Do not restart unrelated Passenger applications, disable the resource guard or stop production applications to gain headroom.
