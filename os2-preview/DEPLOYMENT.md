# Talk2Me OS2 preview deployment

Target hostname: `talk2me.kloka.co.za`

This preview is isolated from the existing Talk2Me production application and does not connect to the production database.

## cPanel application settings

- Node.js version: 20
- Application mode: Production
- Application root: repository checkout folder `/os2-preview`
- Application URL: `talk2me.kloka.co.za`
- Startup file: `server.js`

## Repository branch

Use branch:

`agent/talk2me-os2-foundation`

## Installation

From the OS2 preview application root:

```bash
export PATH="/opt/alt/alt-nodejs20/root/usr/bin:$PATH"
export UV_THREADPOOL_SIZE=1
export NODE_OPTIONS="--v8-pool-size=1 --max-old-space-size=192"
npm install --omit=dev
npm run check
```

Restart the cPanel Node.js application after installation.

## Verification

Open:

- `https://talk2me.kloka.co.za/`
- `https://talk2me.kloka.co.za/health`

The health endpoint must return JSON with `ok: true`.

## Safety

Do not point this preview at the production database. Do not overwrite the existing Talk2Me `.env`, uploads, logs, `.htaccess`, runtime state or backups.
