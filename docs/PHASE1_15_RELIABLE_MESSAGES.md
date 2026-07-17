# Talk2Me CRM v1.15.0

## Fixes
- Tasks are saved before email is attempted.
- Email failure no longer crashes the CRM.
- Nodemailer is loaded safely; missing package is reported on the saved task.
- Related Client ID was replaced by live client search.
- Related open case is selected from a dropdown.
- Client and case relationships are validated before saving.
- Email delivery is optional.

## Deployment
1. Extract this flat ZIP into `public_html/talk2me` and overwrite files.
2. Run **NPM Install** in the cPanel Node.js application screen.
3. Set `APP_VERSION=1.15.0`.
4. Save and restart the application.
5. No SQL migration is required.
