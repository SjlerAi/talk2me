<!-- Repository reading copy of the owner-supplied document; not a V2.x amendment.
Source: GitHub_Managed_Hosting_Deployment_Bible_V2_2026-08-22.docx
Source SHA-256: 7c2e80b3adf1df85806e8fcb446f351ed3a0a451616ff6571f64e42fd13a0603
Owner supplied and reaffirmed this authority on 15 September 2026.
Word pagination and repeating page headers/footers are omitted. Wording, section order and displayed list numbering are retained. -->

# GITHUB ↔ MANAGED HOSTING
# Deployment Bible
# V2.0

Locked server-poller deployment standard for all portfolio developments

## THE PORTFOLIO RULE

One road only. GitHub remains the source of truth. A controlled release is signalled through a dedicated control branch. A permanent deployment agent already installed on the hosting account activates the exact release locally, preserves private runtime configuration, proves the exact hosted SHA, and returns control to HOLD. If this path fails, repair this path. Do not substitute another deployment method.

| Control | Locked value |
| --- | --- |
| Version | V2.0 |
| Effective date | 22 August 2026 |
| Status | LOCKED portfolio deployment standard |
| Owner authority | Product Owner / project owner |
| Reference implementation | Talk2Me Next - proven server-poller path |
| Primary use | ChatGPT/Codex + GitHub + managed/cPanel/Passenger hosting |
| Change rule | No deployment architecture change without explicit owner approval and a proven replacement cycle |

One build. One control plane. No deployment rediscovery.

## Document control and authority

### SUPERSESSION RULE

V2.0 is the operational deployment authority for every project that adopts this standard. Earlier deployment guides are historical reference only. A future agent must not revive an older route, create a parallel route, or reinterpret V2.0 because of a feature defect.

### Order of authority

1. An explicit current decision from the project owner.
2. This Deployment Bible V2.0 and the project-specific V2 profile.
3. Current GitHub evidence: PRs, exact SHAs, CI, control manifest, deployment state and hosted proof.
4. Installed host implementation and runtime evidence.
5. Developer or agent assumptions last. If an assumption conflicts with the above, stop and ask or investigate; do not redesign deployment.

### Version-control rule

- V2.0 is locked. Routine product work must not alter the deployment architecture.
- A documented V2.x amendment is permitted only after a real infrastructure lesson has been proven end-to-end and explicitly approved by the owner.
- A feature, UI, database, image, routing, build or browser defect is never, by itself, authority to change the deployment transport or control plane.
- If a deployment failure occurs, diagnose the exact failed layer and repair only that layer.

## 1. What UAT means

### UAT IS A STATUS, NOT NECESSARILY ANOTHER SERVER

User Acceptance Testing (UAT) describes the operating state of an environment while the owner and staff are validating it. A project may already be in the final domain and application directory. After explicit cutover approval, the same hosted application can become the operational production system without physically moving directories.

- Development/CI: code and automated validation in GitHub.
- UAT/review: the hosted application used for realistic owner/staff acceptance before operational cutover.
- Production/system of record: the environment authorized for real business operation after explicit owner approval.
- Do not confuse environment status with file location. Changing from UAT to production may be an authorization and configuration decision rather than a directory move.

## 2. The locked golden architecture

### ONLY RELEASE SPINE

Chat/Codex → GitHub feature branch → PR/CI → merge → controlled release branch at exact SHA → dedicated GitHub control branch → permanent host poller → dedicated host deploy checkout → installed deploy driver → backup/preserve secrets/activate/restart → exact hosted SHA proof → HOLD → owner UAT.

| Plane | Connection | Responsibility |
| --- | --- | --- |
| 1. Development | ChatGPT/Codex ↔ GitHub | Feature branches, focused changes, PRs, CI, code review, merge history and release identity. |
| 2. Control | GitHub control branch → host poller | Tiny non-secret manifest signals HOLD, DEPLOY or an explicitly approved migration/maintenance action. |
| 3. Activation | Permanent host agent + local deploy driver | Fetch exact release, validate, lock, backup, preserve runtime secrets, deploy locally, restart Passenger and prove the release. |

### Why this architecture is locked

- Routine deployment does not depend on a Chat session retaining an SSH private key.
- The hosting account keeps its own private runtime configuration and database credentials.
- GitHub records the exact source history; the host activates only an explicitly signalled exact release.
- A local lock and last-success state prevent concurrent or repeated activation.
- The deployment driver is installed and stable; a requested release cannot replace the deployment mechanism itself.
- The public application must report the exact deployed SHA before the release is accepted.

## 3. End-to-end deployment flow

| # | Gate | Required action |
| --- | --- | --- |
| 1 | Develop | Work on a focused feature/fix branch from the accepted product baseline. |
| 2 | Validate | Open PR and require CI to pass. Do not deploy unreviewed or unverified code. |
| 3 | Merge | Merge the approved change into the source-of-truth integration line, normally main. |
| 4 | Pin release | Create or advance one controlled release/<description> branch to the exact approved merge SHA. |
| 5 | Signal | Write a unique request to the dedicated control manifest with the exact release branch, exact 40-character SHA, environment and schema contract. |
| 6 | Poll | The permanent host agent sees the control request on its normal schedule and validates it. |
| 7 | Lock | The agent acquires a local deployment lock and refuses malformed, conflicting or already-completed requests. |
| 8 | Fetch exact release | The dedicated host deployment checkout fetches the requested release branch and confirms its remote tip equals the requested SHA. |
| 9 | Activate locally | The installed deployment driver runs the project checks required by the project profile, creates a backup, preserves private runtime files, activates the new release and restarts Passenger. |
| 10 | Prove | The deploy driver and/or external verifier checks the public release endpoint until the exact requested SHA is visible. Feature-specific runtime endpoints are also proven when relevant. |
| 11 | HOLD | Return the control manifest to HOLD and verify it. A completed release is never left in DEPLOY. |
| 12 | Owner UAT | Only after hosted proof does the owner perform browser UAT. Production cutover is always a separate explicit decision. |

## 4. One-time commissioning for every new project

### COMMISSION ONCE, THEN LEAVE IT ALONE

The permanent server-poller path is established during project foundation. Once it is proven, normal feature work must use it as-is. Reinstalling, replacing or bypassing the poller during routine product work is prohibited.

6. Create the GitHub repository and establish the protected source-of-truth integration branch.
7. Create CI that runs the project's syntax, unit, integration and regression checks.
8. Create the managed-hosting application/root and runtime version.
9. Create private runtime configuration on the host (.env/runtime config/database credentials). These values never belong in Git or chat.
10. Create a dedicated host deployment checkout separate from the active application directory.
11. Install a stable deployment agent and deploy driver under a protected host bin directory.
12. Create one cron/scheduler entry for the agent (normally every minute).
13. Create a dedicated GitHub control branch and initial HOLD manifest.
14. Prove that the poller can read HOLD without changing the application.
15. Run one minimal end-to-end UAT deployment through the exact normal path before broad feature development.
16. Record the exact project paths, branch names, control file, health/release endpoints and rollback location in the project-specific V2 profile.

### Commissioning credential rule

- Initial installation may require a one-time secure host session or hosting-panel action, depending on the client environment.
- After commissioning, routine deployments must not depend on the owner or Chat supplying a private key.
- Never paste a private key, database password, token or passphrase into chat, a PR, a GitHub issue, a control manifest or a screenshot.

## 5. Development loop - fixed for all projects

17. Inspect the existing repository and current deployment profile before changing code.
18. Create a focused feature/fix branch. Do not mix infrastructure redesign into normal product work.
19. Implement the smallest coherent change and add/adjust tests.
20. Open a PR and require CI green on the exact head SHA.
21. Merge only the approved change to the integration line.
22. Advance the controlled release branch to that exact merge SHA.
23. If a database migration is required, use only the project's defined guarded migration action and prove the dependent runtime gate before normal deploy.
24. Signal the release through the existing control branch.
25. Wait for the permanent host poller to complete activation and exact hosted proof.
26. Return and verify HOLD.
27. Perform owner/staff UAT in sensible grouped milestones rather than repeated micro-tests.

### Definition of done

- Code is merged through PR/CI.
- The exact release SHA is identifiable.
- The normal deployment path is still green; no manual file reconstruction was required.
- The public release identity reports the exact requested SHA.
- Any affected API/database/business endpoint required for the change is healthy.
- Control is back on HOLD.
- Rollback/backup position remains known.
- Owner acceptance is recorded where visual or business UAT is required.

## 6. Control manifest contract

The control manifest is a signal, never a release archive and never a credential store. The project profile defines its exact path and allowed actions.

| Field | Rule |
| --- | --- |
| version | Fixed manifest contract version. Reject unsupported values. |
| environment | Must exactly match the intended hosted environment (for example review or uat). |
| action | At minimum: hold and deploy. Optional migration/maintenance actions must be explicitly allow-listed by the project profile. |
| requestId | Unique, non-secret, auditable identifier for the controlled attempt. |
| sourceBranch | A controlled release/* branch unless the project profile explicitly locks a different release ref. |
| sourceSha | Exact 40-character Git commit SHA. |
| schemaVersion | Current/required database schema contract marker where the application uses migrations. |

### SAFE IDLE STATE

HOLD is the only normal idle state. After success, failure, cancellation or abandonment, control must be deliberately restored to HOLD and then verified.

## 7. Permanent host agent contract

- Poll only the dedicated control branch/path.
- Validate manifest version, environment, action, request ID, release branch and exact SHA before any mutation.
- Refuse deployment from arbitrary feature branches.
- Use a dedicated deployment checkout separate from developer worktrees and the active application root.
- Take a local lock so only one deployment process can run at a time.
- Use last-success / last-migration state to make repeated requests idempotent.
- Invoke an installed stable deploy driver. Do not execute deployment logic supplied by an arbitrary release branch without validation.
- Keep deployment logs/state private on the host.
- Fail closed. A malformed control request must produce no application or database change.

### Deploy-driver responsibilities

- Confirm the requested checkout resolves to the exact remote release SHA.
- Run only the project-profile checks that are known to be safe on that hosting environment.
- Create a timestamped pre-deploy backup of the active application.
- Preserve the active private .env/runtime configuration and required hosting files such as .htaccess.
- Replace/activate application code deterministically.
- Install or use production dependencies only in the manner explicitly proven for that project; do not improvise during an incident.
- Write a release identity file containing build SHA, release time, source branch and schema marker.
- Restart Passenger/application runtime only after activation is complete.
- Poll the public release endpoint until the exact requested SHA is visible, otherwise fail the release.

## 8. Secrets and security boundaries

| Secret / credential | Belongs here | Never here |
| --- | --- | --- |
| Database credentials | Private host runtime configuration | Git, control manifest, chat, screenshots |
| Runtime API/SMTP tokens | Private host runtime configuration / approved secret store | Git, control manifest, PR body |
| Host deployment identity | Installed host checkout/agent configuration | Feature code |
| One-time commissioning credential | Approved secure setup channel only | Chat or repository history |
| Control manifest | GitHub dedicated control branch | Passwords, private keys or tokens |

### ROUTINE DEPLOYMENT SECURITY RULE

Once the server poller has been commissioned, routine deployment must not require Chat, the project owner or a normal feature workflow to possess a private SSH key.

## 9. Failure and recovery rule

### DO NOT CHANGE THE ROAD BECAUSE ONE VEHICLE HAS A FLAT TYRE

A deployment failure is a layer-specific incident, not permission to redesign deployment. Identify the failed layer, preserve evidence, repair that layer, return control to HOLD, and make one controlled retry.

| Failure layer | Typical evidence | Required response |
| --- | --- | --- |
| GitHub/CI | Tests, syntax or build red | Fix application/test code. Do not touch the host deployment architecture. |
| Control manifest | Invalid action/branch/SHA or stale request | Restore/verify HOLD; correct only the manifest request. |
| Host poller | BUSY, missing checkout/driver, invalid manifest, stale lock | Inspect private agent state/log. Repair installed poller only; do not introduce another transport. |
| Host deploy driver | Dependency, backup, file activation or restart failure | Fix the exact driver/runtime problem and retain the same control plane. |
| Database migration | Schema/API failure | Keep migration action active until the dependent endpoint is proven; use idempotent repair on a new SHA when needed. |
| Public proof | Release endpoint missing/wrong SHA | Do not accept the deploy. Inspect activation/restart/cache; do not mask with a new route. |

### Mandatory incident sequence

28. Stop speculative changes and capture the exact failure.
29. Confirm the current control state. If safe to do so, return/verify HOLD before a new attempt.
30. Identify the single failed layer.
31. Fix only that layer and run the smallest relevant test.
32. Perform one controlled deployment attempt through the same V2 path.
33. If the same failure repeats, stop and reassess. Do not add a second deployment mechanism.
34. Record a proven infrastructure lesson only if it is genuinely new and portfolio-relevant.

## 10. Explicit prohibitions

- Do not create or switch to a parallel deployment workflow during feature work.
- Do not replace the permanent poller because an application feature fails.
- Do not require routine Chat sessions to retain or request a private hosting key.
- Do not manually upload release files through cPanel/FTP as a substitute for the normal deployment path.
- Do not reconstruct project files in Terminal as routine owner work.
- Do not deploy from an arbitrary feature branch.
- Do not leave the control manifest in DEPLOY after a completed or abandoned attempt.
- Do not claim success from CI alone; hosted exact-SHA proof is required.
- Do not claim a database/API repair from /release alone; prove the affected runtime endpoint too.
- Do not touch a production/system-of-record environment without explicit production authorization.
- Do not change this Bible during an incident merely to make the incident fit a new process.

## 11. New-project profile template

Every project using V2 must create one short project profile. The profile supplies values; it does not change the architecture.

| Setting | Project value |
| --- | --- |
| Repository | <owner>/<project> |
| Integration branch | main or protected equivalent |
| Controlled release branch pattern | release/<description> |
| Hosted UAT/review URL | <https://...> |
| Application root | /home/<user>/<app-root> |
| Dedicated deploy checkout | /home/<user>/<project>-deploy |
| Installed poller | /home/<user>/bin/<project>-deploy-agent |
| Installed deploy driver | /home/<user>/bin/<project>-deploy |
| Deployment state/log root | /home/<user>/.<project>-deploy |
| Control branch | deploy/<environment>-control |
| Control manifest | deploy/<environment>.json |
| Poll schedule | normally every minute |
| Release identity endpoint | /release or project equivalent |
| Health endpoint | /health or project equivalent |
| Rollback/backup root | /home/<user>/backups/<project> |
| Allowed control actions | hold, deploy, plus explicitly listed project migration/maintenance actions |
| Production boundary | separate explicit owner authorization |

## 12. Talk2Me Next - validated reference profile

### VALIDATED REFERENCE

Talk2Me Next is the current proof that the V2 server-poller path works. On 22 August 2026 the controlled release branch was advanced to the Business Brain merge SHA, the existing deploy/review-control mechanism activated it through the installed Elitehost poller, hosted proof passed, and control was returned and verified at HOLD.

| Setting | Talk2Me value |
| --- | --- |
| Repository | SjlerAi/talk2me-next |
| Hosted UAT/review URL | https://talk2me.kloka.co.za |
| Review database | kloka_talk2me_next |
| Active application root | /home/kloka/talk2me.kloka.co.za |
| Dedicated deploy checkout | /home/kloka/talk2me-next-deploy |
| Installed poller | /home/kloka/bin/talk2me-review-deploy-agent |
| Installed deploy driver | /home/kloka/bin/talk2me-deploy-review |
| Migration driver | /home/kloka/bin/talk2me-migrate-review |
| State/log root | /home/kloka/.talk2me-deploy |
| Control branch | deploy/review-control |
| Control manifest | deploy/review.json |
| Normal release branch pattern | release/<controlled-description> |
| Public release endpoint | https://talk2me.kloka.co.za/release |
| Poll schedule | Every minute |
| Validated Business Brain SHA | 03db924f05e896de180427fc34633467af2eddce |
| Validated control state | HOLD after restored-proven-poller cycle on 22 Aug 2026 |
| Production/reference boundary | talk2me.uent.co.za / uent_talk2me_crm - hands off until explicit cutover |

### Validated Talk2Me evidence

- PR #38 (9 Aug 2026) established the permanent review deployment control plane specifically so routine host work would not depend on a Chat runtime retaining an SSH private key.
- The installed poller uses deploy/review-control, a dedicated /home/kloka/talk2me-next-deploy checkout, an installed driver, local lock/state and an every-minute cron schedule.
- The deploy driver preserves .env and .htaccess, backs up the active application, activates the exact release, restarts Passenger and accepts success only when the public /release endpoint reports the exact SHA.
- PR #229 (21 Aug 2026) records a successful UAT activation through the existing Talk2Me server-polling deploy/review-control mechanism.
- PR #254 (22 Aug 2026) independently proved the restored server-poller deployment at Business Brain SHA 03db924f05e896de180427fc34633467af2eddce. CI passed Node 20 and 22. The proof PR was closed without merge.
- Current deploy/review-control was then returned to HOLD with request hold-after-restored-proven-poller-2026-08-22T1004Z.

## 13. Every-deployment checklist

- [ ] Focused change merged through PR/CI.
- [ ] Exact merge SHA recorded.
- [ ] Controlled release branch points to that exact SHA.
- [ ] Current control state checked; no stale active request.
- [ ] Unique deploy/migration request written to the dedicated control manifest.
- [ ] Permanent host poller processes the request; no manual file upload.
- [ ] Local lock/idempotency checks pass.
- [ ] Pre-deploy backup created.
- [ ] Private runtime files preserved.
- [ ] Passenger/runtime restarted after activation.
- [ ] Public release endpoint reports exact requested SHA.
- [ ] Affected API/database/runtime endpoint proven where applicable.
- [ ] Control returned to HOLD and verified.
- [ ] Owner UAT completed for the coherent milestone.
- [ ] Production untouched unless separately authorized.

## 14. New-chat / new-agent mandatory instruction

### COPY THIS INSTRUCTION WITH V2.0

Read Deployment Bible V2.0 before touching deployment infrastructure. V2.0 is the only allowed deployment architecture for this project unless the owner explicitly authorizes a future V2.x change. Use GitHub branches/PRs/CI for development. Pin the approved exact SHA to the controlled release branch. Signal deployment only through the dedicated control branch. The already-installed host poller and installed deploy driver perform activation locally. Preserve server-only runtime secrets. Require exact public SHA proof, prove affected runtime endpoints when relevant, and return/verify HOLD after every attempt. If deployment fails, stop, identify the exact failing layer and repair that layer. Do not invent, substitute, bootstrap or switch to another deployment transport during feature work. Do not ask the owner to reconstruct routine project files in Terminal. Production requires separate explicit owner authorization.

## 15. Final locked principle

### DEPLOYMENT IS INFRASTRUCTURE, NOT A FEATURE EXPERIMENT

Build features aggressively; change deployment conservatively. Once the deployment spine is proven, it is treated as fixed infrastructure. Application defects are repaired in the application. Deployment defects are repaired in the existing deployment layer. The route itself changes only through an explicit, evidence-backed owner decision. This prevents a future agent from costing days by rediscovering or replacing a working release path.

OWNER LOCK: Follow the supplied procedure literally and sequentially. No optimization, substitution, workaround, or alternate architecture is authorized. Do not add steps because you think they are helpful. If a required step cannot be performed exactly with your available tools/access, stop and state the blocker. Do not move to another method. Do not make the owner a manual proxy for missing tool access. Continue only from the first unproven gate.

V2.0 LOCKED

One road forward. If it breaks, fix the road - do not build another road.
