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

## Separation from normal validation

Controlled generation writes a lockfile and private evidence. It is therefore not executed by `npm run check`. Normal validation syntax-checks the generator and runs `dependency-lock-generator-check.js` only.

A directly generated lock is operational evidence, not an approved adoption commit. The approved repository adoption path uses the manual generation workflow, verified artifact, controlled materializer, provenance file, and adoption workflow.

## Preconditions

1. The controlled branch is checked out at the intended source commit.
2. `package-lock.json must not already exist` in the application root.
3. `dependency-lock-provenance.json` must not already exist.
4. The application root must be canonical and not writable by group or world users.
5. `package.json` must be a canonical regular single-link file owned by the application owner.
6. The exact canonical Node binary must be supplied through `NODE_BIN`.
7. The exact canonical npm binary must be supplied through `NPM_BIN`.
8. `NODE_BIN` must resolve to the process running the generator.
9. The runtime must be Node.js 20 and npm 10.
10. The private temporary root must be outside the source tree and outside `public_html`.
11. The private evidence directory must be outside the source tree and outside `public_html`.
12. Evidence JSON and checksum sidecar targets must not already exist.
13. Production mutation and customer-merge execution must remain disabled.

## Resolve exact binaries

```bash
readlink -f "$(command -v node)"
readlink -f "$(command -v npm)"
node --version
npm --version
```

## Prepare private directories

```bash
mkdir -p /home/kloka/private_tmp/talk2me-lock
mkdir -p /home/kloka/private_evidence/talk2me-lock
chmod 700 /home/kloka/private_tmp/talk2me-lock
chmod 700 /home/kloka/private_evidence/talk2me-lock
```

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

## Sixty generation controls

1. Exact preview root required.
2. Exact preview database required.
3. Exact controlled branch required.
4. Explicit generation opt-in required.
5. Production mutation refused.
6. Customer-merge execution refused.
7. Node.js 20 required.
8. npm 10 required.
9. Registry pinned to `https://registry.npmjs.org/`.
10. Existing lock overwrite refused.
11. Secure `O_NOFOLLOW` package read required.
12. Symbolic links prohibited.
13. Additional hard links prohibited.
14. Owner consistency required.
15. Unsafe group/world writes prohibited.
16. Package source bounded to 1 MiB.
17. Fatal UTF-8 decoding required.
18. BOM, NUL, and CRLF prohibited.
19. Final newline required.
20. Exact package identity required.
21. Exact main entrypoint required.
22. Exact reviewed direct dependencies required.
23. Lifecycle scripts prohibited.
24. Canonical Node and npm binaries required.
25. Writable or non-executable binaries rejected.
26. Running Node binary identity confirmed.
27. npm version detection bounded.
28. Private external temporary root required.
29. Source-tree temporary storage prohibited.
30. `public_html` temporary storage prohibited.
31. Private external evidence path required.
32. Evidence overwrite prohibited.
33. Randomized `0700` temporary workspace required.
34. Exclusive private package copy required.
35. Sanitized allowlisted environment required.
36. Full parent environment inheritance prohibited.
37. Private npm cache required.
38. User npm configuration disabled.
39. Lifecycle scripts are disabled.
40. Audit during generation disabled.
41. Funding output during generation disabled.
42. Package-lock-only mode required.
43. Lockfile version 3 required.
44. Shell execution disabled.
45. Child output bounded.
46. Generation limited to ten minutes.
47. Forced `SIGKILL` required on timeout.
48. `node_modules must not be created`.
49. Generated lock reopened securely.
50. Exact lock root identity required.
51. Exact root dependency agreement required.
52. Application-root identity rechecked.
53. `package.json` continuity rechecked.
54. Exclusive no-overwrite lock publication required.
55. Safe source permissions required.
56. `dependency-lock-verification.js` required after publication.
57. Exact post-publication SHA-256 evidence required.
58. Failed verification rollback bound to the created digest.
59. A private evidence pair is published atomically.
60. Only the owned temporary workspace is cleaned.

## Expected success evidence

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

## After direct generation

1. Rerun `dependency-lock-verification.js` with the fixed preview identity and safety flags.
2. Review the exact lock and generation evidence.
3. Confirm no `node_modules` or unrelated source file appeared.
4. Do not commit the directly generated lock by itself.
5. Remove the uncommitted direct-generation lock after the operational review when it is no longer needed.
6. Use `OS2 Dependency Lock Generation` to create the approved review artifact for repository adoption.
7. Verify that artifact according to `DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md`.
8. Materialize the exact lock and `dependency-lock-provenance.json` through `dependency-lock-adoption-materializer.js`.
9. Commit exactly the approved two-file adoption according to `DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md`.
10. Require the adoption workflow and normal preview CI to pass.

## Hard stops

Stop when the lock already exists, runtime identity differs, the registry differs, source permissions are unsafe, `package.json` changes, `node_modules` appears, npm exits non-zero, a timeout occurs, generated lock identity differs, independent verification fails, private evidence cannot be published, or any production/merge safety flag is enabled.

Controlled generation does not deploy, migrate, restart, back up, restore, commit, or modify production.
