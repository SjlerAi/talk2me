#!/bin/bash
# Dedicated TK2M PRODUCTION release poller (one-time commissioned under Bible V2.1).
# Reads only deploy/tk2m-crm-live-control.json on the existing dedicated GitHub
# control branch. Does not read, re-enable or modify the retired staging poller.
set -Eeuo pipefail
umask 077
export PATH="/opt/alt/alt-nodejs20/root/usr/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

CONTROL=/home/talk/tk2m-crm-deploy-control
STATE=/home/talk/crm-live/ops
DRIVER=/home/talk/crm-live/ops/deploy-tk2m-live
APP=/home/talk/repositories/talk2me-crm-stage
MANIFEST="$CONTROL/deploy/tk2m-crm-live-control.json"
CONTROL_REF=refs/heads/deploy/tk2m-crm-control
RELEASE_URL=https://crm.tk2m.co.za/api/release
HEALTH_URL=https://crm.tk2m.co.za/api/health

fail(){ printf 'TK2M_PROD_POLLER_REFUSED: %s\n' "$*" >&2; exit 1; }
[[ -f /home/talk/crm-live/PRODUCTION_ACTIVE ]] || fail "production marker absent"
[[ -d "$CONTROL/.git" && -x "$DRIVER" && -d "$APP/.git" ]] || fail "installed production control/driver missing"
exec 8>"$STATE/production-poller.lock"
flock -n 8 || exit 0

head="$(git -C "$CONTROL" ls-remote origin "$CONTROL_REF" | cut -f1)"
[[ "$head" =~ ^[a-f0-9]{40}$ ]] || fail "GitHub control ref unavailable"
if [[ "$(git -C "$CONTROL" rev-parse HEAD)" != "$head" ]]; then
  git -C "$CONTROL" fetch --quiet --no-tags origin "$CONTROL_REF"
  [[ "$(git -C "$CONTROL" rev-parse FETCH_HEAD)" == "$head" ]] || fail "control SHA mismatch"
  git -C "$CONTROL" checkout --quiet --detach "$head"
fi
[[ -f "$MANIFEST" ]] || fail "no separately approved production manifest"
parsed="$(node - "$MANIFEST" <<'JS'
const fs=require('node:fs');
const m=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const fail=t=>{console.error('Invalid TK2M production manifest: '+t);process.exit(2)};
if(m.schema!==1||m.environment!=='tk2m-production'||m.production_cutover!==true)
  fail('production identity');
if(!['hold','deploy'].includes(m.action))fail('action');
if(typeof m.request_id!=='string'||!/^tk2m-[a-zA-Z0-9_-]{8,80}$/.test(m.request_id))fail('request id');
if(typeof m.release_branch!=='string'||!/^release\/tk2m-[a-zA-Z0-9._/-]+$/.test(m.release_branch))
  fail('release branch');
if(typeof m.release_sha!=='string'||!/^[a-f0-9]{40}$/.test(m.release_sha))fail('release SHA');
if(m.action==='deploy' && m.owner_approved!==true)fail('owner approval');
if(m.action==='deploy' && (typeof m.expected_previous_sha!=='string' ||
    !/^[a-f0-9]{40}$/.test(m.expected_previous_sha)))fail('previous SHA guard');
console.log([m.action,m.release_branch,m.release_sha,m.request_id,
  m.expected_previous_sha||'none'].join(' '));
JS
)"
read -r action branch sha request expected_previous <<< "$parsed"
[[ "$action" == hold ]] && exit 0


# V2 PAIRING CONTRACT: the existing private driver must be upgraded and tested
# alongside this poller. Never install this candidate independently.
# contract-v2/status/dry-run are non-activating; status is backed by a durable
# journal, not by the current checkout. run prepares/activates, preserves the
# previous receipt and rollback artifacts, and journals the attempt. finalize
# independently rechecks the exact live worker and writes the verified receipt
# only after the poller proves it; rollback restores source/dependencies/metadata
# and the previous receipt. No automatic destructive database restore.
# No automatic replay of failed, interrupted or indeterminate operations.
current="$(git -C "$APP" rev-parse HEAD)"
last="$(cat "$STATE/last-verified-release" 2>/dev/null)" ||
  fail "verified baseline receipt unavailable"
read -r last_request last_sha last_branch extra <<< "$last"
[[ "$last_request" =~ ^tk2m-[a-zA-Z0-9_-]{8,80}$ &&
   "$last_sha" =~ ^[a-f0-9]{40}$ &&
   "$last_branch" =~ ^release/tk2m-[a-zA-Z0-9._/-]+$ &&
   -z "${extra:-}" ]] || fail "invalid verified baseline receipt"

prove_live(){
  local sha="$1" expected_branch="$2" after="${3:-}" release health
  release="$(curl -fsS --max-time 7 "$RELEASE_URL")" || return 1
  health="$(curl -fsS --max-time 7 "$HEALTH_URL")" || return 1
  node - "$sha" "$expected_branch" "$after" "$release" "$health" <<'JS'
const [,,sha,branch,after,releaseText,healthText]=process.argv;
try {
 const release=JSON.parse(releaseText),health=JSON.parse(healthText);
 if(release.commit!==sha || release.workerBootCommit!==sha ||
    release.sourceBranch!==branch ||
    typeof release.workerBootTime!=='string' ||
    !Number.isFinite(Date.parse(release.workerBootTime)) ||
    (after && (!Number.isFinite(Date.parse(after)) ||
      Date.parse(release.workerBootTime)<=Date.parse(after))) ||
    release.environment!=='production' ||
    release.productionCutover!==true || release.stagingOnly!==false ||
    health.environment!=='production' || health.status!=='ok' ||
    health.database!=='connected') process.exit(1);
 console.error('TK2M_PRODUCTION_SHA_HEALTH_PASS '+sha);
 console.log(release.workerBootTime);
} catch(_) {process.exit(1)}
JS
}
contract="$("$DRIVER" "$branch" "$sha" "$request" contract-v2)" ||
  fail "paired v2 driver not commissioned"
[[ "$contract" == TK2M_DRIVER_V2_ACTIVATION_JOURNAL_AND_RECEIPT ]] ||
  fail "unsupported driver contract"
status="$("$DRIVER" "$branch" "$sha" "$request" status)" ||
  fail "driver request journal unavailable"

# A completed request may be observed again without replaying any writes.
if [[ "$current" == "$sha" && "$last" == "$request $sha $branch" ]]; then
  [[ "$status" == TK2M_DRIVER_V2_COMMITTED ]] ||
    fail "receipt exists but driver finalization not proven"
  prove_live "$sha" "$branch" >/dev/null ||
    fail "previously accepted release does not match hosted production"
  exit 0
fi
[[ "$status" == TK2M_DRIVER_V2_NEW ]] ||
  fail "request previously attempted or unresolved; do not replay"
[[ "$sha" != "$expected_previous" && "$current" == "$expected_previous" &&
   "$last_sha" == "$current" ]] ||
  fail "release drift or same-SHA request; audited reconciliation required"
baseline_boot="$(prove_live "$expected_previous" "$last_branch")" ||
  fail "previous worker, branch and database not proven"

rollback_and_fail(){
  local reason="$1" rollback_status trial
  printf 'TK2M_PRODUCTION_ACTIVATION_FAILED: %s\n' "$reason" >&2
  if ! "$DRIVER" "$branch" "$sha" "$request" rollback; then
    fail "rollback failed; unresolved journal; incident review required"
  fi
  rollback_status="$("$DRIVER" "$branch" "$sha" "$request" status)" ||
    fail "rollback journal unavailable"
  [[ "$rollback_status" == TK2M_DRIVER_V2_ROLLED_BACK &&
     "$(git -C "$APP" rev-parse HEAD)" == "$expected_previous" &&
     "$(cat "$STATE/last-verified-release")" == "$last" ]] ||
    fail "rollback state/receipt not proven; incident review required"
  for trial in 1 2 3; do
    if prove_live "$expected_previous" "$last_branch" >/dev/null; then
      fail "activation failed; previous release restored and hosted proof PASS; HOLD required"
    fi
    sleep 5
  done
  /usr/sbin/cloudlinux-selector restart --json --interpreter nodejs --user talk --app-root "$APP" ||
    fail "rollback worker restart refused; incident review required"
  for trial in 1 2 3 4 5 6; do
    if prove_live "$expected_previous" "$last_branch" >/dev/null; then
      fail "activation failed; previous release restored and hosted proof PASS; HOLD required"
    fi
    sleep 5
  done
  fail "rollback worker proof failed; incident review required"
}

finalize_candidate(){
  [[ "$(git -C "$APP" rev-parse HEAD)" == "$sha" &&
     "$(cat "$STATE/last-verified-release")" == "$last" ]] ||
    rollback_and_fail "source/receipt changed before finalization"
  # An indeterminate finalization must be reconciled, never blindly rolled back
  # or replayed. The durable driver journal must retain the recovery evidence.
  "$DRIVER" "$branch" "$sha" "$request" finalize ||
    fail "finalization indeterminate; preserve journal and reconcile"
  local committed
  committed="$("$DRIVER" "$branch" "$sha" "$request" status)" ||
    fail "finalization journal unavailable"
  [[ "$committed" == TK2M_DRIVER_V2_COMMITTED &&
     "$(git -C "$APP" rev-parse HEAD)" == "$sha" &&
     "$(cat "$STATE/last-verified-release")" == "$request $sha $branch" ]] ||
    fail "final receipt/status mismatch; reconcile without replay"
  prove_live "$sha" "$branch" "$baseline_boot" >/dev/null ||
    fail "post-finalization worker proof failed; incident review required"
  printf 'TK2M_PRODUCTION_DEPLOY_PROVEN request=%s sha=%s\n' "$request" "$sha"
  printf 'TK2M_PRODUCTION_DEPLOY_REQUIRES_CONTROL_HOLD\n'
}

# Record exactly which CRM Passenger worker was running before this release.
# Never infer it from a generic 'node' PID or touch another app's worker.
crm_worker_pids() {
  ps -eo pid=,args= | awk '$2=="lsnode:/home/talk/repositories/talk2me-crm-stage/" {print $1}'
}
pre_deploy_pid="$(crm_worker_pids)"
if [[ -n "$pre_deploy_pid" && ! "$pre_deploy_pid" =~ ^[0-9]+$ ]]; then
  fail "multiple or invalid CRM workers; refuse automatic process operation"
fi

# The paired v2 driver must durably record an attempt before any mutation.
# dry-run is non-activating and rejects replay or an unresolved journal.
"$DRIVER" "$branch" "$sha" "$request" dry-run
if ! "$DRIVER" "$branch" "$sha" "$request" run; then
  rollback_and_fail "driver activation failed"
fi
[[ "$(cat "$STATE/last-verified-release")" == "$last" ]] ||
  rollback_and_fail "driver wrote a receipt before worker proof"
[[ "$(git -C "$APP" rev-parse HEAD)" == "$sha" ]] ||
  rollback_and_fail "activated checkout does not match approved SHA"

# First permit Passenger to refresh naturally. A file-based /api/release SHA
# is NOT proof of loaded code; prove_live verifies the worker's boot SHA.
for trial in 1 2 3; do
  if prove_live "$sha" "$branch" "$baseline_boot" >/dev/null; then
    finalize_candidate
    exit 0
  fi
  sleep 5
done

# The application-scoped CloudLinux restart is preferred and never targets
# Zippy, UENT or the whole hosting account.
/usr/sbin/cloudlinux-selector restart --json --interpreter nodejs --user talk --app-root "$APP" ||
  rollback_and_fail "scoped CloudLinux CRM restart refused"
for trial in 1 2 3; do
  if prove_live "$sha" "$branch" "$baseline_boot" >/dev/null; then
    finalize_candidate
    exit 0
  fi
  sleep 5
done

# LiteSpeed sometimes ignores its own successful restart response. Kill only
# the SAME pre-release worker after verifying a unique PID, owner, exact cwd,
# and exact lsnode command. If anything moved, fail closed for manual review.
current_pid="$(crm_worker_pids)"
if [[ -n "$pre_deploy_pid" && "$current_pid" == "$pre_deploy_pid" ]]; then
  owner="$(ps -o user= -p "$current_pid" | tr -d '[:space:]')"
  actual_cwd="$(readlink "/proc/$current_pid/cwd" 2>/dev/null || true)"
  command="$(ps -o args= -p "$current_pid" | sed 's/[[:space:]]*$//')"
  [[ "$owner" == talk && "$actual_cwd" == "$APP" &&
     "$command" == "lsnode:$APP/" ]] ||
    rollback_and_fail "CRM-only process identity was not proven; no signal sent"
  kill -TERM "$current_pid"
  echo "TK2M_CRM_SCOPED_WORKER_RESTART old_pid=$current_pid"
elif [[ -n "$current_pid" ]]; then
  rollback_and_fail "CRM worker changed unexpectedly while runtime SHA is stale; no signal sent"
fi

for trial in 1 2 3 4 5 6; do
  if prove_live "$sha" "$branch" "$baseline_boot" >/dev/null; then
    finalize_candidate
    exit 0
  fi
  sleep 5
done
rollback_and_fail "new worker boot SHA/health not proven"
