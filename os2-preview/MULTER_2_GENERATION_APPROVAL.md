# Multer 2.2.0 Dependency-Evidence Generation Approval

Status: not approved
Related issue: #85
Preview version: 0.60.0
Controlled branch: `agent/talk2me-os2-integrated-rebuild`
Exact candidate dependency: `multer@2.2.0`

## Purpose

This record separates target selection from permission to generate dependency evidence. Selecting Multer 2.2.0 does not authorize editing `package.json`, generating a candidate `package-lock.json`, installing candidate dependencies, adopting an artifact, activating preview runtime, or changing production.

## Current authorization state

- Owner generation approval granted: no
- Candidate manifest creation authorized: no
- Dependency-lock generation authorized: no
- Dependency-lock adoption authorized: no
- Preview activation authorized: no
- Production mutation authorized: no

## Exact future approval phrase

A future owner approval must state this exact phrase:

`APPROVE_MULTER_2_2_0_DEPENDENCY_EVIDENCE_GENERATION`

The phrase authorizes only a controlled candidate-evidence generation cycle for exact `multer@2.2.0` on the controlled preview branch. It does not authorize adoption, deployment, restart, preview UAT, database access, migrations, workers, or production changes.

## Required source identity at approval time

The approval record must include all of the following before generation:

1. the exact 40-character source commit SHA;
2. the exact controlled branch;
3. preview application version `0.60.0`;
4. exact candidate `multer@2.2.0`;
5. an approval timestamp in canonical UTC;
6. the approving owner identity;
7. confirmation that production mutation remains disabled;
8. confirmation that dependency adoption remains separately gated.

## Fail-closed rule

While status remains `not approved`, the active dependency must remain `^1.4.5-lts.1`, the committed lock must remain unchanged, and no candidate generation workflow may be represented as authorized.
