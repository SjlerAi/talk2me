# Multer 2.2.0 Candidate Manifest Plan

Status: planned, not authorized, not applied
Related issue: #85
Controlled branch: `agent/talk2me-os2-integrated-rebuild`
Preview version: `0.60.0`

## Purpose

Define the exact candidate `package.json` transformation for review without changing the active manifest, generating a lock, installing dependencies, activating preview runtime or mutating production.

## Exact transformation

Only this dependency value may change in a separately authorized candidate cycle:

- from `"multer": "^1.4.5-lts.1"`
- to `"multer": "2.2.0"`

No semver range, tag, alias, URL, file path, workspace reference or pre-release version is permitted.

## Required continuity

The candidate manifest must retain exactly:

- name `talk2me-os2-preview`;
- version `0.60.0`;
- `private: true`;
- main entrypoint `server.js`;
- the existing scripts object without additions, removals or value changes;
- every non-Multer direct dependency name and value;
- no `devDependencies`, `optionalDependencies`, bundled dependencies or workspaces;
- no lifecycle scripts.

## Candidate isolation

The candidate manifest must be created only in a private temporary workspace outside the repository source tree and outside any public web root. It must not overwrite committed `package.json` or `package-lock.json`.

The candidate cycle must bind evidence to:

1. exact approval phrase `APPROVE_MULTER_2_2_0_DEPENDENCY_EVIDENCE_GENERATION`;
2. approving owner identity;
3. canonical UTC approval timestamp;
4. approved 40-character source commit SHA;
5. exact controlled branch;
6. exact candidate `multer@2.2.0`;
7. source `package.json` SHA-256;
8. candidate `package.json` SHA-256;
9. generated candidate lock SHA-256;
10. production mutation disabled and adoption separately gated.

## Prohibited effects

This plan does not authorize:

- changing the committed manifest;
- changing or adopting the committed lock;
- creating `node_modules` in the source tree;
- deployment or restart;
- database access or migrations;
- workers or scheduled jobs;
- preview activation or UAT;
- production mutation.

## Rejection conditions

Reject the candidate if more than the exact Multer dependency value changes, if any continuity requirement fails, if evidence is not bound to the approved source identity, or if artifact/provenance verification fails.
