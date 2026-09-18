# Deployment authority moved to Deployment Bible V2.0

The deployment instructions formerly kept in this file described a GitHub Actions → SSH/SCP artifact-push workflow. That route is superseded and is not an authorized routine deployment path.

**Current authority:** [Deployment Bible V2.0](DEPLOYMENT_BIBLE_V2_2026-08-22.md)

**Talk2Me UI-UAT profile:** [DEPLOYMENT_PROFILE_V2.md](DEPLOYMENT_PROFILE_V2.md)

Routine releases must use the locked server-poller spine:

feature/fix branch → PR/CI → approved merge → controlled `release/*` branch at exact SHA → `deploy/ui-uat-control` manifest → permanent host poller → local deploy driver → exact hosted SHA proof → HOLD → owner UAT.

Do not revive the former SSH/SCP routine workflow, even during an incident. If the permanent poller path fails, repair that exact layer and keep the same control plane.
