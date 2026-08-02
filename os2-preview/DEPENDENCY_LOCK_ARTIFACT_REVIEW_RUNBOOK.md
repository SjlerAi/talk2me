# Talk2Me OS2 Dependency Lock Artifact Review

## Purpose

This runbook governs review of the artifact produced by the manual **OS2 Dependency Lock Generation** workflow. The artifact is evidence for a proposed dependency lock and is not permission to deploy, migrate, restart, or modify production.

The production remains untouched throughout this process.

## Expected identity

The verifier requires:

- repository `SjlerAi/talk2me`;
- ref `refs/heads/agent/talk2me-os2-integrated-rebuild`;
- workflow `OS2 Dependency Lock Generation`;
- a full lowercase 40-character source commit;
- a positive workflow run ID;
- a positive workflow run attempt;
- application `talk2me-os2-preview` version `0.59.0`;
- database identity `kloka_talk2me`;
- production mutation disabled;
- customer-merge execution disabled.

## Exact artifact contents

The verifier accepts this exact 13-file set:

```text
SHA256SUMS
dependency-lock-artifact-governance.json
dependency-lock-generation.json
dependency-lock-generation.json.sha256
dependency-lock-generator-governance.json
dependency-lock-governance.json
dependency-lock-verification.json
dependency-lock-workflow-governance.json
generator-result.json
manifest.txt
package-lock.json
source-integrity-postinstall.json
source-integrity-preinstall.json
```

Every missing, additional, hidden, nested, linked, or renamed entry is rejected.

`SHA256SUMS` must cover `package-lock.json`, all nine JSON evidence files, and `manifest.txt`. The dedicated `dependency-lock-generation.json.sha256` sidecar separately binds the original generation evidence.

## Private extraction

Extract the downloaded artifact into a private `0700` directory outside the repository and outside `public_html`. Every artifact entry must use private `0600` files.

Example:

```bash
mkdir -p /home/kloka/private_evidence/talk2me-lock-review/run-12345-attempt-1
chmod 700 /home/kloka/private_evidence/talk2me-lock-review/run-12345-attempt-1
chmod 600 /home/kloka/private_evidence/talk2me-lock-review/run-12345-attempt-1/*
```

The verifier rejects symbolic links, additional hard links, owner mismatches, group/world access, non-canonical paths, unstable descriptor metadata, oversized files, unexpected entries, and path traversal.

## Verification command

Run from `/home/kloka/repositories/talk2me/os2-preview` using the exact workflow identity:

```bash
DEPENDENCY_LOCK_ARTIFACT_ROOT=/home/kloka/private_evidence/talk2me-lock-review/run-12345-attempt-1 \
EXPECTED_REPOSITORY=SjlerAi/talk2me \
EXPECTED_REF=refs/heads/agent/talk2me-os2-integrated-rebuild \
EXPECTED_COMMIT_SHA=<exact-40-character-workflow-commit> \
EXPECTED_WORKFLOW='OS2 Dependency Lock Generation' \
EXPECTED_RUN_ID=<positive-run-id> \
EXPECTED_RUN_ATTEMPT=<positive-run-attempt> \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
node dependency-lock-artifact-verification.js
```

## Verification controls

1. Absolute normalized artifact path required.
2. `public_html` locations prohibited.
3. Canonical artifact directory required.
4. Directory symbolic links prohibited.
5. Directory owner consistency required.
6. Private `0700` directory permissions required.
7. `O_DIRECTORY | O_NOFOLLOW` opening required.
8. Directory path and descriptor identity must match.
9. Directory security metadata must remain stable.
10. The exact 13-file set is required.
11. Hidden files are prohibited.
12. Nested directories are prohibited.
13. Path separators in filenames are prohibited.
14. Artifact path escape is prohibited.
15. Every entry must be a regular file.
16. File symbolic links are prohibited.
17. Additional hard links are prohibited.
18. File owner must match directory owner.
19. Private `0600` permissions are required.
20. File sizes are bounded.
21. Canonical file paths are required.
22. `O_NOFOLLOW` reads are required.
23. Path and descriptor device/inode must match.
24. Size and modification time must remain stable.
25. Owner and mode must remain stable.
26. Exact descriptor byte counts are required.
27. Fatal UTF-8 decoding is required.
28. UTF-8 byte-order marks are prohibited.
29. NUL bytes are prohibited.
30. CRLF line endings are prohibited.
31. Final newlines are required.
32. JSON roots must be objects.
33. `SHA256SUMS` must contain exactly 11 entries.
34. Every checksum must be lowercase SHA-256.
35. Two spaces must separate checksum and filename.
36. Duplicate checksum filenames are prohibited.
37. Unknown checksum filenames are prohibited.
38. Checksum path traversal is prohibited.
39. Complete checksum coverage is required.
40. Digest comparisons use constant-time comparison.
41. The generation sidecar is mandatory.
42. The sidecar filename must be exact.
43. The sidecar checksum must match generation evidence.
44. `package-lock.json` identity must be exact.
45. `lockfileVersion` must equal `3`.
46. The lock root must match application name and version.
47. The exact six direct dependencies must match.
48. The manifest must contain exactly ten keys.
49. Manifest repository, ref, commit, and workflow must match.
50. Manifest run ID and attempt must match.
51. Manifest source and lock digests must be lowercase SHA-256.
52. Manifest safety flags must be `false`.
53. Manifest lock digest must match the actual lock.
54. Generation and generator-result evidence must match the lock.
55. Independent lock verification must match the lock.
56. All four governance evidence files must report 60 controls.
57. Pre-install source evidence must succeed.
58. Post-install source evidence must succeed.
59. Pre/post/manifest source inventory continuity must match.
60. Password, token, secret, authorization, cookie, and database-password fields are prohibited.

## Required success evidence

```text
check: dependency-lock-artifact-verification
meaningfulControls: 60
exactFileSetVerified: true
artifactDirectoryPrivate: true
artifactFilesPrivate: true
exactChecksumCoverageVerified: true
constantTimeChecksumComparison: true
generationSidecarVerified: true
packageLockIdentityVerified: true
manifestIdentityVerified: true
generationEvidenceVerified: true
independentLockVerificationVerified: true
governanceEvidenceVerified: true
sourceInventoryContinuityVerified: true
secretFieldsRejected: true
productionMutationEnabled: false
mergeExecutionEnabled: false
```

## Controlled adoption after review

After successful verification:

1. Confirm the workflow run belongs to the exact intended source commit.
2. Review `package-lock.json` and the dependency graph.
3. Confirm the high-severity dependency audit passed.
4. Confirm pre-install and post-install source digests are identical.
5. Retain the artifact-verification result with GitHub Issue #83.
6. Follow `DEPENDENCY_LOCK_ADOPTION_RUNBOOK.md`.
7. Run `dependency-lock-adoption-materializer.js` to publish `package-lock.json` and `dependency-lock-provenance.json` together.
8. Review both published files.
9. Commit exactly those two files as the immediate child of the generation source commit.
10. Require the `OS2 Dependency Lock Adoption` workflow and normal preview CI to pass.

Do not copy or commit only the lockfile. Provenance is required for controlled adoption.

## Hard stops

Stop when artifact verification fails, the file set differs, permissions are not private, checksums differ, source inventory continuity fails, workflow identity differs, secrets appear in evidence, the dependency audit failed, or the intended source commit changed after artifact generation.
