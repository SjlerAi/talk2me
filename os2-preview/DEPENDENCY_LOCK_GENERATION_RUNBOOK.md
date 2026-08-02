# Talk2Me OS2 Controlled Dependency Lock Generation

## Purpose

This runbook governs one explicit generation of `os2-preview/package-lock.json` for the controlled Talk2Me preview rebuild.

It applies only to:

- application root `/home/kloka/repositories/talk2me/os2-preview`;
- database identity `kloka_talk2me`;
- branch `agent/talk2me-os2-integrated-rebuild`;
- Node.js 20;
- npm 10;
- registry `https://registry.npmjs.org/`.

Production at `talk2me.uent.co.za` remains untouched.

## Why this is separate

The current release path requires a committed dependency lock before CI, dependency audit, source approval and release freeze can pass. Controlled lock generation is intentionally separate from ordinary validation because it writes `package-lock.json` and private provenance evidence.

The generator is not executed by `npm run check`. Normal validation only syntax-checks the generator and executes `dependency-lock-generator-check.js`.

## Preconditions

1. The controlled branch is checked out at the intended commit.
2. `package-lock.json` must not already exist.
3. The application root must be canonical, owned by the operator and not writable by group or world users.
4. `package.json` must be a canonical, regular, single-link file owned by the application-root owner.
5. The exact real Node.js binary must be supplied through `NODE_BIN`.
6. The exact canonical executable npm binary must be supplied through `NPM_BIN`.
7. `NODE_BIN` must resolve to the binary running the generator.
8. The runtime must be Node.js 20 and npm 10.
9. A private temporary root must exist outside the application source tree and outside `public_html`.
10. A private evidence directory must exist outside the application source tree and outside `public_html`.
11. The evidence JSON and checksum sidecar must not already exist.
12. Production mutation and customer-merge execution must remain disabled.

## Resolve the exact binaries

Use the real canonical paths rather than a shell alias or symlink. Typical cPanel locations differ by host, so resolve them before running.

```bash
readlink -f "$(command -v node)"
readlink -f "$(command -v npm)"
node --version
npm --version
```

The required runtime is Node.js 20 and npm 10.

## Prepare private directories

Example only; use paths owned by the preview operator:

```bash
mkdir -p /home/kloka/private_tmp/talk2me-lock
mkdir -p /home/kloka/private_evidence/talk2me-lock
chmod 700 /home/kloka/private_tmp/talk2me-lock
chmod 700 /home/kloka/private_evidence/talk2me-lock
```

The temporary root and evidence parent must be absolute, normalized, canonical, non-symlink directories owned by the application-root owner. Group and world access is prohibited.

## Controlled generation command

Run from `/home/kloka/repositories/talk2me/os2-preview`:

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
NODE_BIN=/absolute/canonical/path/to/node \
NPM_BIN=/absolute/canonical/path/to/npm \
DEPENDENCY_LOCK_TEMP_ROOT=/home/kloka/private_tmp/talk2me-lock \
DEPENDENCY_LOCK_EVIDENCE_PATH=/home/kloka/private_evidence/talk2me-lock/dependency-lock-generation.json \
ALLOW_DEPENDENCY_LOCK_GENERATION=true \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
node dependency-lock-generator.js
```

## Generation controls

The generator:

1. Requires the exact preview root.
2. Requires `DB_NAME=kloka_talk2me`.
3. Requires the controlled branch.
4. Requires `ALLOW_DEPENDENCY_LOCK_GENERATION=true`.
5. Refuses production mutation.
6. Refuses customer-merge execution.
7. Requires Node.js 20.
8. Requires npm 10.
9. Pins the npm registry to `https://registry.npmjs.org/`.
10. Refuses to overwrite an existing `package-lock.json`.
11. Securely reads `package.json` through `O_NOFOLLOW`.
12. Rejects symbolic links and additional hard links.
13. Requires owner consistency.
14. Rejects unsafe group or world write permissions.
15. Bounds the package source to 1 MiB.
16. Uses fatal UTF-8 decoding.
17. Rejects a byte-order mark, NUL bytes and CRLF.
18. Requires a final newline.
19. Requires the exact package identity and private flag.
20. Requires the exact main entrypoint.
21. Requires the reviewed direct-dependency set.
22. Rejects package lifecycle scripts.
23. Requires absolute canonical Node and npm binaries.
24. Rejects writable or non-executable npm binaries.
25. Confirms the supplied Node binary matches the current process.
26. Runs npm version detection with a 15-second bound.
27. Requires a private external temporary root.
28. Refuses a temporary root inside the source tree.
29. Refuses a temporary root inside `public_html`.
30. Requires a private external evidence path.
31. Requires a `.json` evidence filename.
32. Refuses evidence overwrite.
33. Creates a randomized private `0700` temporary workspace.
34. Copies `package.json` through an exclusive `0600` write.
35. Uses a sanitized allowlisted environment.
36. Does not inherit the full parent environment.
37. Sets a private npm cache inside the temporary workspace.
38. Disables user npm configuration through `/dev/null`.
39. Forces lifecycle scripts off.
40. Disables audit during generation.
41. Disables funding output during generation.
42. Uses package-lock-only mode.
43. Forces lockfile version 3.
44. Uses shell-disabled argument-array execution.
45. Limits output capture to 4 MiB.
46. Limits generation to 10 minutes.
47. Uses forced `SIGKILL` on timeout.
48. Rejects unexpected `node_modules` creation.
49. Securely reads the generated candidate lock.
50. Requires exact lock root identity.
51. Requires exact root dependency agreement with `package.json`.
52. Rechecks the application-root identity after generation.
53. Rechecks that `package.json` did not change.
54. Publishes `package-lock.json` atomically and without overwrite.
55. Publishes the source lock with non-writable group/world permissions.
56. Runs `dependency-lock-verification.js` after publication.
57. Requires matching post-publication SHA-256 evidence.
58. Removes only its own checksum-matching lock after failed verification.
59. Publishes a private evidence JSON and SHA-256 sidecar atomically.
60. Cleans only its own verified temporary workspace.

## Expected success evidence

A successful run must report:

```text
check: dependency-lock-generation
packageLockVerifiedAfterPublication: true
packageJsonUnchangedDuringGeneration: true
packageLockPublishedAtomically: true
packageLockOverwriteAllowed: false
lifecycleScriptsExecuted: false
nodeModulesGenerated: false
registryPinned: true
fullParentEnvironmentInherited: false
evidencePrivate: true
productionMutationEnabled: false
mergeExecutionEnabled: false
```

The evidence pair is private operational evidence and must not be committed to the public source tree.

## After generation

1. Run the independent verifier again:

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
node dependency-lock-verification.js
```

2. Review the exact `package-lock.json` diff.
3. Confirm no `node_modules` directory or other generated source files appeared.
4. Commit `package-lock.json` on the controlled branch.
5. Run the full source-only preview activation preflight again.
6. Allow CI to run `npm ci --ignore-scripts --no-audit --no-fund`.
7. Require `npm audit --omit=dev --audit-level=high` to pass.
8. Retain the exact CI source digest and build-evidence artifact.

## Hard stops

Stop immediately when the lock already exists, the runtime identity is wrong, the registry differs, source ownership or permissions are unsafe, the package changes during generation, `node_modules` appears, npm exits non-zero, the timeout is reached, the generated lock does not match the package, the independent verifier fails, or private evidence cannot be published atomically.

Controlled lock generation does not deploy, migrate, restart, back up, restore or modify production.
