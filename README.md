# Zippy standalone personal assistant (Talk2Me project)

The standalone Node 22 app lives in `apps/zippy/`, deployed independently at `https://zippy.uent.co.za` via a distinct CloudLinux Passenger app rooted at `/home/uent/zippy-app`. All personal records use a separate `uent_Zippy` MySQL database, never the CRM database.

Zippy provides one Gerda-only login, private reminders, recurring appointments, contacts, browser voice input (English/Afrikaans), push notifications (after device permission), and server-side minute scheduling. Its protected scheduler is reached by one lightweight cron curl, avoiding a second Node process on shared CloudLinux hosting.

The opt-in CRM bridge source is `src/routes/zippy-bridge.js` and remains disabled until the UAT CRM integration is configured with a separate signed key and verified Gerda staff identity. CRM instructions are never sent before explicit confirmation.

Development: `cd apps/zippy && npm run check`. Passwords, tokens, DB credentials, and private contact information must never be committed.
