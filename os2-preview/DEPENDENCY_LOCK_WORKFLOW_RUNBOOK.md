# OS2 Dependency Lock Generation Workflow

## Purpose

This runbook governs the manual GitHub Actions workflow that produces a reviewable `package-lock.json` artifact for the Talk2Me OS2 preview rebuild.

The workflow does not commit files, deploy, migrate a database, restart an application, or touch production. The production remains untouched.

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

The workflow requires this exact input:

```text
GENERATE_OS2_LOCK
```

Any other value fails before generation.

## Trigger procedure

1. Open the repository Actions tab.
2. Select **OS2 Dependency Lock Generation**.
3. Select **Run workflow**.
4. Confirm `agent/talk2me-os2-integrated-rebuild`.
5. Enter `GENERATE_OS2_LOCK` exactly.
6. Start the workflow.
7. Require every step to succeed.
8. Download the review artifact.

The workflow must never run for push or pull-request events.

## Source identity controls

The workflow verifies:

- event is `workflow_dispatch`;
- repository is `SjlerAi/talk2me`;
- ref and ref name are the controlled branch;
- commit SHA is 40 lowercase hexadecimal characters;
- `package-lock.json` does not already exist;
- `node_modules` does not already exist;
- production mutation is disabled;
- customer-merge execution is disabled.

## Pinned actions and runtime

The workflow pins immutable commit SHAs for:

- `actions/checkout`;
- `actions/setup-node`;
- `actions/upload-artifact`.

Checkout credentials are not persisted. Checkout depth is one commit.

Canonical Node and npm binaries are resolved with `readlink -f`. Node.js 20 and npm 10 are mandatory.

## Private runner directories

Temporary generation, evidence, and artifact directories are located under GitHub `RUNNER_TEMP`, outside the repository. Private operational directories use mode `0700`; artifact files use mode `0600` before verification and upload.

## Controlled generation

The workflow invokes:

```text
node dependency-lock-generator.js
```

The generator requires:

- exact preview root, database, and branch;
- explicit generation opt-in;
- Node.js 20 and npm 10;
- registry `https://registry.npmjs.org/`;
- package-lock-only execution;
- lifecycle scripts disabled;
- no audit or funding output during generation;
- lockfile version 3;
- private temporary and evidence locations;
- shell execution disabled;
- bounded execution and output;
- exclusive no-overwrite publication;
- independent post-publication verification;
- production mutation disabled;
- merge execution disabled.

## Evidence and governance

The workflow verifies the generation evidence checksum and requires matching application, version, database, branch, lock digest, registry, lifecycle-script, environment, and safety evidence.

Before installation it runs:

```text
node dependency-lock-verification.js
node dependency-lock-governance-check.js
node dependency-lock-generator-check.js
node dependency-lock-workflow-check.js
node dependency-lock-artifact-check.js
```

Any failure blocks publication.

## Source continuity, installation, and audit

The workflow captures the pre-install `inventorySha256`, then runs:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm audit --omit=dev --audit-level=high
```

`npm install` is prohibited. High or critical production dependency findings block the workflow.

After installation, protected source integrity is recalculated and must match the pre-install digest. `node_modules` is removed. Git status must then contain only:

```text
?? os2-preview/package-lock.json
```

## Review artifact

The artifact contains the exact 13-file set documented in `DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md`, including:

- `package-lock.json`;
- generation, verification, generator, workflow, and artifact governance evidence;
- pre-install and post-install source-integrity evidence;
- `manifest.txt`;
- `SHA256SUMS`;
- the dedicated generation-evidence checksum sidecar.

The manifest records repository, branch ref, source commit, workflow identity, run identity, source inventory digest, lock digest, and disabled production/merge safety flags.

The workflow verifies the complete artifact through `dependency-lock-artifact-verification.js` before upload. Missing files are fatal. The artifact expires after seven days.

## Review and controlled adoption

After a successful workflow:

1. Download the artifact.
2. Follow `DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md`.
3. Verify the exact source commit, run ID, run attempt, checksums, and source inventory continuity.
4. Review the complete dependency graph and lock diff.
5. Confirm the high-severity audit passed.
6. Follow `DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md`.
7. Run `dependency-lock-adoption-materializer.js` against the verified private artifact.
8. Review both generated files:

```text
os2-preview/package-lock.json
os2-preview/dependency-lock-provenance.json
```

9. Commit exactly those two files as the immediate child of the generation source commit.
10. Require the `OS2 Dependency Lock Adoption` workflow to pass.
11. Require normal OS2 Preview CI to pass for the exact adoption commit.
12. Record the generation run, artifact digest, provenance, adoption commit, adoption workflow, and CI status in GitHub Issue #83.

The generation workflow does not commit automatically. Automatic repository writes remain prohibited.

## Failure handling

When any step fails:

- do not reuse partial output;
- do not manually copy an unverified lock;
- do not commit only `package-lock.json` without provenance;
- inspect the failed step and logs;
- correct the source or governance issue on the controlled branch;
- start a new manual generation run;
- use only a fully successful artifact.

## Completion boundary

A successful generation artifact is not deployment approval. The two-file adoption commit must still pass adoption verification, normal CI, dependency audit, source-integrity approval, backup and restore gates, migration gates, preview-data verification, deployment governance, automated UAT, and formal UAT.
