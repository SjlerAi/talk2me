# Talk2Me OS2 Dependency Lock Adoption

## Purpose

This runbook governs how a verified dependency-lock review artifact is materialized into the controlled branch and how the resulting two-file adoption commit is independently verified.

Production at `talk2me.uent.co.za` remains untouched. This process does not deploy, migrate, restart, modify a database, or enable customer-merge execution.

## Fixed identity

- Repository: `SjlerAi/talk2me`
- Branch: `agent/talk2me-os2-integrated-rebuild`
- Ref: `refs/heads/agent/talk2me-os2-integrated-rebuild`
- Application: `talk2me-os2-preview`
- Version: `0.59.0`
- Database identity: `kloka_talk2me`
- Generation workflow: `OS2 Dependency Lock Generation`
- Node.js: 20.x
- Provenance freshness at adoption: no more than 168 hours

## Required inputs

The materializer requires the private extracted artifact that has already passed `dependency-lock-artifact-verification.js`.

Retain the exact values from the successful generation workflow:

```text
source commit
workflow run ID
workflow run attempt
repository
branch ref
workflow name
```

The application workspace must not already contain either:

```text
package-lock.json
dependency-lock-provenance.json
```

## Controlled materialization

Run from `/home/kloka/repositories/talk2me/os2-preview`:

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
DEPENDENCY_LOCK_ARTIFACT_ROOT=/home/kloka/private_evidence/talk2me-lock-review/run-12345-attempt-1 \
EXPECTED_REPOSITORY=SjlerAi/talk2me \
EXPECTED_REF=refs/heads/agent/talk2me-os2-integrated-rebuild \
EXPECTED_SOURCE_COMMIT=<exact-generation-source-commit> \
EXPECTED_WORKFLOW='OS2 Dependency Lock Generation' \
EXPECTED_RUN_ID=<positive-generation-run-id> \
EXPECTED_RUN_ATTEMPT=<positive-generation-run-attempt> \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
node dependency-lock-adoption-materializer.js
```

The materializer first reruns the full artifact verifier in a bounded, shell-disabled child process. It then independently reopens and validates the artifact lock, manifest, and generation evidence before publishing anything.

## Materialization controls

1. Exact preview root required.
2. Exact preview database required.
3. Exact controlled branch required.
4. Exact repository required.
5. Exact branch ref required.
6. Exact generation workflow name required.
7. Full lowercase source commit required.
8. Positive generation run ID required.
9. Positive generation run attempt required.
10. Node.js 20 required.
11. Production mutation must remain disabled.
12. Customer-merge execution must remain disabled.
13. Existing `package-lock.json` is a hard stop.
14. Existing provenance is a hard stop.
15. Canonical application root required.
16. Unsafe application-root writes prohibited.
17. Private canonical artifact directory required.
18. Artifact owner must match the application owner.
19. Full artifact verification is mandatory.
20. Artifact verification has a 30-second limit.
21. Artifact verification uses forced `SIGKILL` on timeout.
22. Artifact verification uses shell execution disabled.
23. Artifact verification output is bounded.
24. Artifact verification JSON evidence is required.
25. Artifact package lock is reopened with `O_NOFOLLOW`.
26. Artifact manifest is reopened with `O_NOFOLLOW`.
27. Artifact generation evidence is reopened with `O_NOFOLLOW`.
28. Symbolic links are prohibited.
29. Additional hard links are prohibited.
30. Artifact file owner consistency is required.
31. Private artifact file permissions are required.
32. Artifact file sizes are bounded.
33. Path and descriptor identity must match.
34. Descriptor metadata must remain stable.
35. Fatal UTF-8 decoding is required.
36. BOM, NUL, CRLF, and missing final newline are rejected.
37. Manifest repository, ref, commit, and workflow must match.
38. Manifest run ID and attempt must match.
39. Manifest lock digest must match the artifact lock.
40. Manifest source inventory digest must be lowercase SHA-256.
41. Manifest safety flags must be false.
42. Generation evidence application identity must match.
43. Generation evidence version must match.
44. Generation evidence database and branch must match.
45. Generation evidence lock digest must match.
46. Generation timestamp must be canonical UTC.
47. Provenance uses an exact 15-field schema.
48. Provenance records the exact source commit.
49. Provenance records the exact source inventory digest.
50. Provenance records generation run identity.
51. Provenance records automatic commit as false.
52. Provenance records production mutation as false.
53. Provenance records merge execution as false.
54. Lock publication uses exclusive no-overwrite semantics.
55. Provenance publication uses exclusive no-overwrite semantics.
56. Published files use safe `0644` source permissions.
57. Published file checksums are reread and confirmed.
58. Partial publication rollback is checksum-bound.
59. The materializer never runs Git commands or commits automatically.
60. Unexpected publication state is preserved for manual review.

## Review and commit

After successful materialization:

1. Review both new files.
2. Confirm `package-lock.json` matches the artifact digest.
3. Confirm `dependency-lock-provenance.json` matches the generation workflow identity.
4. Confirm no other workspace file changed.
5. Commit exactly these two paths in one commit:

```text
os2-preview/package-lock.json
os2-preview/dependency-lock-provenance.json
```

The adoption commit must be the immediate child of the recorded generation source commit. Do not combine unrelated changes with the adoption commit.

## Adoption verification workflow

The `OS2 Dependency Lock Adoption` workflow runs with read-only repository permission. It accepts a push or manual dispatch only on the controlled branch and requires:

- the adoption commit to have exactly one parent;
- the parent to equal provenance `sourceCommit`;
- exactly the two approved files to differ;
- provenance age not greater than 168 hours;
- exact provenance and lock digest agreement;
- `npm ci --ignore-scripts --no-audit --no-fund`;
- the full integrated validation suite;
- `npm audit --omit=dev --audit-level=high`;
- unchanged pre-install and post-install source inventory digests;
- a clean workspace after removing `node_modules`;
- private checksum-backed adoption evidence.

The workflow never writes to the repository and never commits automatically.

## Manual provenance verification

The environment-bound verifier can also be run manually against the committed adoption:

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
EXPECTED_REPOSITORY=SjlerAi/talk2me \
EXPECTED_REF=refs/heads/agent/talk2me-os2-integrated-rebuild \
EXPECTED_SOURCE_COMMIT=<provenance-source-commit> \
CURRENT_COMMIT=<adoption-commit> \
PROVENANCE_MAX_AGE_HOURS=168 \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
node dependency-lock-provenance-verification.js
```

## Required evidence

Successful provenance verification must report:

```text
check: dependency-lock-provenance-verification
meaningfulControls: 60
exactProvenanceSchemaVerified: true
exactSourceIdentityVerified: true
sourceCommitContinuityVerified: true
provenanceFreshnessVerified: true
packageLockDigestVerified: true
constantTimeDigestComparison: true
secretFieldsRejected: true
automaticCommit: false
productionMutationEnabled: false
mergeExecutionEnabled: false
```

Successful adoption workflow evidence must be retained with GitHub Issue #83.

## Hard stops

Stop when the artifact verifier fails, the source commit differs, the adoption is not a single immediate-child commit, the changed-file set differs, provenance is older than 168 hours, either digest differs, the dependency audit fails, source inventory changes during installation, the workspace is dirty after cleanup, or any production/merge safety flag is enabled.
