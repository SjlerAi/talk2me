# Zippy 2.0 — lightweight Android/iPhone pilot

**Status:** Feature branch only. Never copy files to live Passenger until CI,
safe deployment and rollback are verified. Back up the private database first.

## Platform decision

Use the existing Elite Hosting **Node.js 22 / Express** standalone application,
private MySQL, PWA manifest and one-minute reminder cron. The mobile interface
is intentionally **plain HTML/CSS/JavaScript**, not a Svelte or React bundle:
no framework download, new build tool, daemon or database pool is needed.

Zippy stays at https://zippy.uent.co.za, independent from Talk2Me at
https://uent.co.za/talk2me. Owner-only access remains (Gerda and an explicitly
authorised owner test account). Johnny and ordinary staff use only Talk2Me.

## Elite Hosting configuration

Configure the Zippy application's own server environment, not only Talk2Me's.
Do not post API keys in chat, HTML, GitHub or logs. Verify these settings:

- OPENAI_API_KEY — authorised server-side OpenAI API key
  (alternatively ZIPPY_AI_API_KEY or ZIPPY_STT_API_KEY)
- ZIPPY_STT_ENABLED=1 — enable on-demand multilingual audio transcription
- ZIPPY_STT_MODEL=gpt-4o-mini-transcribe — transcription model
- ZIPPY_AI_ENABLED=1 — conversational AI and natural-language interpretation
- ZIPPY_AI_MODEL — an enabled Responses API model available to your API account

Only one OpenAI key is needed when OPENAI_API_KEY is provided. The AI and
transcription features share it, without exposing it to the browser.
If missing, typing and existing reminders continue, while voice falls back
to browser recognition with manual English/Afrikaans selection.

## First build functionality

1. Compact opening screen: friendly greeting, chat history, microphone,
   editable text area and an explicit Send button.
2. Voice review: tap microphone to record (maximum 30 seconds), tap again
   to stop, inspect/edit the transcription, then tap Send. No auto-send.
3. Multilingual audio: WebM on supporting Android browsers and MP4 on
   supporting iPhone browsers, with OpenAI automatic language detection.
4. Private chat: authenticated owner-specific history saved in Zippy MySQL.
   Audio is processed on demand and never stored as an audio file.
5. Read-only Talk2Me reports: today's birthdays, staff login/clock-in evidence
   and monthly upgrades, optionally filtered by recognised staff name.
   Owner-signed and bounded; no CRM customer/task mutations.
6. Existing CRM task review → confirm → tracked progress remains in place.
7. Existing push reminders remain. Verify delivery independently on both phones.

## Device acceptance

### Android (Gerda)
1. Open https://zippy.uent.co.za and sign in as an authorised owner.
2. Install the PWA from Chrome and enable notifications.
3. Say: "Watter kliënte verjaar vandag?" Stop recording, inspect words, Send.
4. Verify a genuine CRM report or an explicit unavailable error.
5. Say: "Herinner my môre om nege om my ma te bel" and test a near-term
   reminder, including phone notification when the PWA is closed.
6. Prepare an instruction for Johnny and verify the NOT SENT review before
   an explicit confirmation. Do not send real work during smoke tests.

### iPhone (authorised owner tester)
1. Open with Safari and Add to Home Screen; launch the installed icon.
2. Check microphone permissions and WebM/MP4 capability automatically.
3. Test Afrikaans and English, review transcription, correct and Send.
4. Verify separate owner history and notifications in the installed PWA.
5. Verify no background always-listening behaviour is implied.

### Deployment operator checks
- Run npm --prefix apps/zippy run check in an isolated checkout, not the
  live Passenger app root.
- Verify both /api/health and the public unauthenticated /api/me response.
- Verify the voice and chat endpoints refuse unauthenticated access.
- Inspect cPanel thread/process headroom without terminating other domains.
- Verify API key availability by presence only; never display secret values.
- Back up private MySQL and release files, stage and verify exact release SHA,
  confirm CRM lookup bridge support and test rollback.
- Check owner/Johnny permissions and Talk2Me health afterward.
- Verify birthday/attendance responses against genuine read-only CRM data.

## Deferred

- Real system-wide floating desktop widget: a lightweight Tauri companion
  requires an authorised native desktop installation.
- External WhatsApp: official WhatsApp Business Platform approval, verified
  recipients, message templates where applicable, consent and audit.
- External Google/Outlook calendar write-back: separate user authorisation.
- Locked-screen always-listening audio and native alarm guarantees.
