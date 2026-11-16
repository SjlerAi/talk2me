# Portfolio Deployment Bible V2.1 adoption — 16 November 2026

## Owner decision and scope
On 16 November 2026, the owner approved **GitHub ↔ Managed Hosting Deployment Bible V2.1** as the working authority for the development portfolio. It supersedes August 2026 portfolio V2.0 for future work, but **does not approve any new deployment mechanism, migration, or production change**.

- Central Master Space: https://chatgpt.com/space/page_6afab9a773148191a7dc0b5017e9fd45
- Full owner-approved V2.1 Word/PDF and working reference: https://chatgpt.com/space/page_510bce26e0408191bbd9c7544ddee8be
- Project Space page: https://chatgpt.com/space/page_bd26397c5ed081919c5b43e866cf4848
- Guide for new tasks: https://chatgpt.com/space/page_7a8e219f3e788191a0690734bd141283
- Project scope: TK2M CRM, staff tasks and messages, customer database, reporting and Zippy interfaces

## Mandatory method
1. Read the full V2.1 Bible, this project's existing deployment profile, AGENTS.md where present, current issues/PRs, and repository working state; inspect host evidence when relevant.
2. Work on focused feature/fix branches. Validate with tests, PR reviews and CI, and merge only after required owner approval.
3. Pin the approved merge SHA on the controlled release branch. Signal through the **existing** dedicated GitHub deployment control branch and manifest.
4. The already-installed **permanent host poller** and installed driver handle local activation, backup, private runtime preservation, runtime restart and release verification.
5. Prove the exact hosted SHA and affected business/API/DB endpoints, then restore and verify **HOLD**; perform grouped owner/staff UAT. Production cutover needs **separate explicit owner authorization**.
6. The remote terminal is an authorised tool for **read-only diagnostics and specifically approved maintenance**. It is **not a parallel routine deployment mechanism**. Do not use manual production file replacement, cPanel/FTP uploads, direct production Git pulls or ad-hoc runtime restarts instead of the locked path.
7. Never place passwords, private keys, tokens, runtime .env secrets, personal data or database dumps in Git, chat, Space or control manifests.
8. Record status precisely: proposed, implemented, CI-checked, merged, release-signalled, hosted-SHA-proven, affected-runtime-proven, HOLD-verified and owner-accepted. A source snapshot is not live-system proof.
9. If a gate fails, stop that release, identify the exact failed layer and repair that layer. Independent safe work may continue, but don't bypass the gate or invent a substitute.
10. Update the project record and the next unproven gate after material work. Avoid restarting completed work or claiming that old notes are current proof.

## Project-specific precautions
Do not assume this repository is the sole currently deployed TK2M source. Verify live TK2M host, database, schema, release SHA, application permissions and exact project profile before any deployment or data change.

## Documentation status
This is a **documentation-only adoption proposal**. Existing project-specific deployment profiles/credentials/host state must be checked and reconciled before use. This document does not itself constitute a release approval. Existing installed deploy machinery is unchanged.
