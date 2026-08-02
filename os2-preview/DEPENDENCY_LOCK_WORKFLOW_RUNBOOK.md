# OS2 Dependency Lock Generation Workflow

## Purpose

This runbook governs the manual GitHub Actions workflow that generates a reviewable `package-lock.json` artifact for the Talk2Me OS2 preview rebuild.

The workflow does not commit files, does not deploy, does not migrate a database, does not restart an application, and does not touch production.

Production remains untouched throughout this process.

## Workflow identity

- Workflow: `OS2 Dependency Lock Generation`
- File: `.github/workflows/os2-dependency-lock-generation.yml`
- Event: `workflow_dispatch` only
- Repository: `SjlerAi/talk2me`
- Branch: `agent/talk2me-os2-integrated-rebuild`
- Application root: `os2-preview`
- Database identity: `kloka_talk2me`
- Node.js: 20
- npm: 10
- Repository permission: read-only repository permission
- Artifact retention: seven days

## Manual confirmation

The workflow requires this exact confirmation input:

```text
GENERATE_OS2_LOCK
```

Any other value fails before generation.

## Trigger procedure

1. Open the repository Actions tab.
2. Select **OS2 Dependency Lock Generation**.
3. Select **Run workflow**.
4. Confirm the branch is `agent/talk2me-os2-integrated-rebuild`.
5. Enter `GENERATE_OS2_LOCK` exactly.
6. Start the workflow.
7. Wait for every step to finish successfully.
8. Download the generated review artifact.

The workflow must never be enabled for push or pull-request events.

## Source identity controls

The workflow verifies:

- event is `workflow_dispatch`;
- repository is `SjlerAi/talk2me`;
- ref is the controlled branch;
- ref name is the controlled branch;
- commit SHA is exactly 40 lowercase hexadecimal characters;
- `package-lock.json` does not already exist;
- `node_modules` does not already exist;
- production mutation is disabled;
- customer-merge execution is disabled.

## Action pinning

The workflow uses immutable action commit SHAs for:

- `actions/checkout`;
- `actions/setup-node`;
- `actions/upload-artifact`.

Checkout credentials are not persisted and checkout depth is one commit.

## Private runner directories

The workflow creates temporary and evidence directories beneath GitHub `RUNNER_TEMP`.

Both directories are set to mode `0700`. They must not be located inside the repository workspace.

The generated private operational evidence is copied into the final review artifact only after all controls pass.

## Runtime identity

The workflow resolves the canonical Node and npm binaries using `readlink -f` and requires:

```text
Node.js major: 20
npm major: 10
```

The exact resolved binaries are supplied to `dependency-lock-generator.js`.

## Controlled generation

The workflow invokes only:

```text
node dependency-lock-generator.js
```

The generator itself requires:

- exact preview application root;
- exact preview database identity;
- exact controlled branch;
- explicit generation opt-in;
- production mutation disabled;
- customer-merge execution disabled;
- Node.js 20;
- npm 10;
- npm registry pinned to `https://registry.npmjs.org/`;
- private external temporary storage;
- private external evidence storage;
- package-lock-only execution;
- lifecycle scripts disabled;
- no audit or funding output during generation;
- lockfile version 3;
- shell execution disabled;
- bounded execution and output;
- exclusive no-overwrite publication;
- independent post-publication verification.

## Evidence verification

The workflow requires:

- `package-lock.json` exists and is non-empty;
- no `node_modules` directory was created during generation;
- generation evidence JSON exists;
- generation evidence SHA-256 sidecar exists;
- generator result JSON exists;
- sidecar verification succeeds with `sha256sum --check`;
- evidence identities match the application, version, database and branch;
- evidence lock digest matches the generated `package-lock.json`;
- independent post-publication verification succeeded;
- lifecycle scripts did not run;
- no generation-time `node_modules` directory was created;
- full parent environment was not inherited;
- registry pinning succeeded;
- production mutation and merge execution remained disabled.

## Governance execution

Before dependency installation, the workflow runs:

```text
node dependency-lock-verification.js
node dependency-lock-governance-check.js
node dependency-lock-generator-check.js
node dependency-lock-workflow-check.js
```

Any failure blocks artifact publication.

## Protected source identity

Before installation, the workflow runs the protected workspace inventory and records `inventorySha256`.

The evidence must report:

```text
ok: true
packageLockPresent: true
inventorySha256: 64 lowercase hexadecimal characters
```

## Installation and audit

The generated lock is then tested through:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm audit --omit=dev --audit-level=high
```

`npm install` is prohibited.

High or critical production dependency findings block the workflow.

## Source continuity

After installation and validation, the workflow recalculates protected workspace source integrity.

The post-install digest must equal the pre-install digest exactly.

The workflow then removes `node_modules` and requires Git status to show only:

```text
?? os2-preview/package-lock.json
```

Any additional modified or untracked source file blocks artifact publication.

## Review artifact

The artifact contains:

- `package-lock.json`;
- dependency lock generation evidence;
- dependency lock verification evidence;
- dependency lock governance evidence;
- generator governance evidence;
- workflow governance evidence;
- pre-install source-integrity evidence;
- post-install source-integrity evidence;
- `manifest.txt`;
- `SHA256SUMS`.

The manifest records:

- repository;
- branch ref;
- exact commit;
- workflow name;
- workflow run ID;
- workflow attempt;
- protected source inventory SHA-256;
- generated lock SHA-256;
- production mutation disabled;
- merge execution disabled.

`SHA256SUMS` is verified before upload.

The artifact upload uses `if-no-files-found: error` and expires after seven days.

## Review and commit procedure

After a successful workflow:

1. Download the artifact.
2. Verify `SHA256SUMS` locally.
3. Confirm the manifest commit equals the intended branch head.
4. Confirm the source inventory digest matches workflow evidence.
5. Review the complete `package-lock.json` diff.
6. Confirm no unexpected dependency or registry appears.
7. Confirm every package integrity field and resolved URL passes the independent verifier.
8. Add only `os2-preview/package-lock.json` to the controlled branch.
9. Commit with a clear dependency-lock message.
10. Push the controlled branch.
11. Require the normal OS2 Preview CI workflow to pass for the exact new commit.
12. Record the workflow run, artifact digest, committed lock digest and resulting CI status in GitHub Issue #83.

The generation workflow does not commit automatically. Automatic repository writes are prohibited.

## Failure handling

When any step fails:

- do not reuse partial output;
- do not manually copy an unverified lockfile;
- inspect the failed step and logs;
- correct the source or governance issue on the controlled branch;
- start a new manual workflow run;
- use only the artifact from a fully successful run.

## Completion boundary

A successful lock-generation artifact is not deployment approval. The committed lock must still pass normal CI, dependency audit, source-integrity approval, backup and restore gates, migration gates, preview data verification, deployment governance, automated UAT and formal UAT.

Record all accepted evidence in GitHub Issue #83.
