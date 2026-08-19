# Talk2Me GitHub-to-Elitehost deployment

## Purpose

Talk2Me releases are built and validated on GitHub-hosted runners. Elitehost receives one immutable, SHA256-verified release archive over a short SSH/SCP connection. A permanent, low-resource cron agent on Elitehost activates only the exact commit and workflow run requested through the dedicated control branch.

This replaces routine cPanel Terminal deployments. It does not apply SQL, run migrations, or modify production data.

## Fixed identities

- Repository: `SjlerAi/talk2me`
- GitHub Environment: `talk2me-uat`
- Target site: `https://talk2me.uent.co.za`
- SSH account: `uent@164.160.91.40:41414`
- Application directory: `/home/uent/talk2me.uent.co.za`
- Source checkout: `/home/uent/repositories/talk2me`
- Control branch: `deploy/uat-control`
- Control manifest: `deploy/uat.json`

The `talk2me-uat` environment owns exactly these encrypted secrets:

- `ELITEHOST_SSH_PRIVATE_KEY`
- `ELITEHOST_SSH_KEY_PASSPHRASE`

Never copy either secret into chat, repository files, logs, workflow inputs, artifacts, or the production host beyond the authorized public key already installed there.

## One-time commissioning

1. Merge the deployment infrastructure to `main` after CI passes.
2. Create `deploy/uat-control` from that exact `main` commit. Its committed `deploy/uat.json` must say `HOLD`.
3. Run **Verify Elitehost connection** from GitHub Actions. It validates the encrypted key, passphrase, account identity and expected directories without changing the application.
4. Run **Bootstrap Elitehost UAT agent**, entering `BOOTSTRAP UAT AGENT`. It installs the two executable agent files, private state/inbox directories, the control checkout and a single marked cron entry.
5. Confirm the bootstrap output reports `control=HOLD`.

## Routine deployment

Run **Deploy Talk2Me to Elitehost UAT** from the `main` branch and enter `DEPLOY UAT`.

The workflow:

1. installs dependencies and runs every existing validator;
2. assembles production code and production dependencies on GitHub;
3. embeds release metadata containing the exact commit and workflow run;
4. creates and revalidates a SHA256 checksum;
5. transfers the immutable archive and checksum into the private Elitehost inbox;
6. commits a `DEPLOY` request to the control branch;
7. waits until the public health and release endpoints prove that exact run is live;
8. returns the control branch to `HOLD`, whether deployment succeeds or fails.

The server agent validates the repository, environment, commit, run ID, artifact name and checksum again. The driver backs up the current code, preserves `.env`, `.htaccess`, uploads, logs, `.well-known` and runtime state, activates the release, restarts Passenger, verifies the exact public release, and rolls back activation if verification fails.

## Public verification

- `/api/health` proves the application and database connection are available.
- `/api/release` reports non-secret build identity including commit and workflow run ID.

Successful deployment requires both endpoints and an exact commit/run match. A generic HTTP 200 response is not sufficient.

## Database rule

Automated deployment never runs `npm run db:migrate`, `scripts/migrate.js`, a `.sql` file, or a database client. Any future schema or data change remains a separately reviewed and explicitly authorized operation with its own backup and validation procedure.

## Recovery and diagnostics

On failure, the GitHub job collects the agent request record, agent log and Passenger stderr. The control manifest is still returned to `HOLD`. Code backups are retained under `/home/uent/deployment-backups/talk2me`; protected production data is never included in release artifacts or overwritten during activation.
