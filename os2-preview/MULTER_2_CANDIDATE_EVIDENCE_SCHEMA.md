# Multer 2.2.0 Candidate Evidence Schema

Status: defined, generation not authorized, no evidence emitted
Related issue: #85
Schema version: `1`
Controlled branch: `agent/talk2me-os2-integrated-rebuild`
Preview application: `talk2me-os2-preview`
Preview version: `0.60.0`
Exact candidate: `multer@2.2.0`

## Purpose

Define the exact machine-readable evidence contract for a future separately approved Multer 2.2.0 candidate dependency-lock generation cycle. This schema does not authorize candidate creation, dependency installation, lock generation, lock adoption, preview activation or production mutation.

## Exact top-level keys

A future evidence JSON object must contain exactly these keys:

1. `schemaVersion`
2. `check`
3. `ok`
4. `repository`
5. `branch`
6. `sourceCommit`
7. `application`
8. `applicationVersion`
9. `currentMulter`
10. `candidateMulter`
11. `approvalPhrase`
12. `approvingOwner`
13. `approvedAt`
14. `generatedAt`
15. `sourcePackageSha256`
16. `candidatePackageSha256`
17. `candidateLockSha256`
18. `sourceInventorySha256`
19. `onlyMulterDependencyChanged`
20. `sourceManifestUnchanged`
21. `committedLockUnchanged`
22. `lifecycleScriptsExecuted`
23. `sourceTreeNodeModulesCreated`
24. `dependencyAdoptionAuthorized`
25. `previewActivationAuthorized`
26. `productionMutationEnabled`
27. `rollbackRequired`
28. `rollbackCompleted`

No additional key is permitted.

## Exact values and formats

- `schemaVersion` must equal `1`.
- `check` must equal `multer-2-candidate-evidence`.
- `ok` must be `true` only after all candidate checks pass.
- `repository` must equal `SjlerAi/talk2me`.
- `branch` must equal `agent/talk2me-os2-integrated-rebuild`.
- `sourceCommit` must be exactly 40 lowercase hexadecimal characters and must equal the approved commit.
- `application` must equal `talk2me-os2-preview`.
- `applicationVersion` must equal `0.60.0`.
- `currentMulter` must equal `^1.4.5-lts.1`.
- `candidateMulter` must equal `2.2.0`.
- `approvalPhrase` must equal `APPROVE_MULTER_2_2_0_DEPENDENCY_EVIDENCE_GENERATION`.
- `approvingOwner` must be a non-empty bounded identity without control characters.
- `approvedAt` and `generatedAt` must be canonical UTC timestamps with millisecond precision and trailing `Z`.
- `generatedAt` must not precede `approvedAt` and must not be more than 24 hours after approval.
- All four SHA-256 fields must be exactly 64 lowercase hexadecimal characters.
- `onlyMulterDependencyChanged`, `sourceManifestUnchanged` and `committedLockUnchanged` must be `true`.
- `lifecycleScriptsExecuted`, `sourceTreeNodeModulesCreated`, `dependencyAdoptionAuthorized`, `previewActivationAuthorized` and `productionMutationEnabled` must be `false`.
- `rollbackRequired` and `rollbackCompleted` must both be booleans. When rollback is required, rollback completion must be true before evidence may be accepted.

## Digest binding

The future verifier must independently recalculate and compare:

- committed source `package.json` SHA-256;
- isolated candidate `package.json` SHA-256;
- generated candidate `package-lock.json` SHA-256;
- protected source inventory SHA-256.

Digest comparison must use constant-time comparison after strict lowercase hexadecimal validation.

## Approval binding

The evidence is invalid unless the approval record contains the exact phrase, approving owner, canonical UTC timestamp and approved source commit. Candidate evidence generation does not grant adoption, preview activation or production activation.

## Rollback evidence

A failed candidate cycle must remove only candidate files whose independently verified digests match the files created by that cycle. Unexpected files must be preserved for manual review. No committed source file may be deleted or overwritten.

## Prohibited contents

Evidence must not contain credentials, environment dumps, absolute private paths, session identifiers, cookies, authorization headers, database connection values or arbitrary command output.
