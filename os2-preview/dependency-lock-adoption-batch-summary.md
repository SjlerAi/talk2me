# Dependency Lock Adoption Batch Summary

## Batch identity

- Meaningful controls: 60
- Application: `talk2me-os2-preview`
- Version: `0.59.0`
- Branch: `agent/talk2me-os2-integrated-rebuild`
- Database identity: `kloka_talk2me`
- Production mutation: disabled
- Customer-merge execution: disabled

## Delivered controls

This batch establishes a controlled transition from a verified dependency-lock review artifact to a provenance-bound two-file adoption commit.

The implementation includes:

- exact provenance schema and source identity verification;
- canonical UTC timestamp and freshness controls;
- package-lock SHA-256 binding with constant-time comparison;
- a read-only provenance verifier;
- a controlled no-overwrite materializer;
- artifact reverification before materialization;
- checksum-bound partial-publication rollback;
- an exact two-file adoption commit contract;
- immediate-parent source continuity;
- a read-only adoption workflow;
- `npm ci`, integrated validation, and high-severity dependency audit gates;
- pre-install and post-install source inventory continuity;
- clean-workspace enforcement;
- private checksum-backed adoption evidence;
- activation, CI, topology, package-command, source-inventory, and runbook integration.

## Execution boundary

The generation workflow, artifact verifier, adoption materializer, provenance verifier, adoption workflow, dependency installation, dependency audit, preview deployment, database migrations, restart, and UAT were not executed by this source-governance batch.
