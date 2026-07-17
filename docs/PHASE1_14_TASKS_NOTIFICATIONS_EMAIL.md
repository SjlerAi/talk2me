# Talk2Me CRM v1.14.0

Adds staff tasks and notifications, unread bell count, owner task control, comments, completion tracking and SMTP email delivery to the staff member's login email.

## Install
1. Extract this flat ZIP over `public_html/talk2me`.
2. Import `migrations/014_staff_tasks_notifications.sql`.
3. Run NPM Install because Nodemailer was added.
4. Set `APP_VERSION=1.14.0`.
5. Add SMTP environment variables documented in the release message.
6. Restart the Node.js app.
