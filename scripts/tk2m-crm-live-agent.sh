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

# Refuse a stale request if production has moved since owner approval.
current="$(git -C "$APP" rev-parse HEAD)"
if [[ "$current" != "$expected_previous" && "$current" != "$sha" ]]; then
  fail "host release changed; expected previous or requested SHA"
fi

prove_live(){
  local release health
  release="$(curl -fsS --max-time 7 "$RELEASE_URL")" || return 1
  health="$(curl -fsS --max-time 7 "$HEALTH_URL")" || return 1
  node - "$sha" "$release" "$health" <<'JS'
const [,,sha,releaseText,healthText]=process.argv;
try {
 const release=JSON.parse(releaseText),health=JSON.parse(healthText);
 if(release.commit!==sha || release.environment!=='production' ||
    release.productionCutover!==true || release.stagingOnly!==false ||
    health.environment!=='production' || health.status!=='ok' ||
    health.database!=='connected') process.exit(1);
 console.log('TK2M_PRODUCTION_SHA_HEALTH_PASS '+sha);
} catch(_) {process.exit(1)}
JS
}

last="$(cat "$STATE/last-verified-release" 2>/dev/null || true)"
if [[ "$last" == "$request $sha $branch" ]]; then
  prove_live || fail "previously accepted release does not match hosted production"
  exit 0
fi
[[ "$current" == "$expected_previous" ]] || fail "target already installed but no matching verified release"

"$DRIVER" "$branch" "$sha" "$request" dry-run
"$DRIVER" "$branch" "$sha" "$request" run

# Passenger restart is asynchronous; verify actual HTTPS identity, not just files.
for trial in 1 2 3 4 5 6; do
  if prove_live; then
    printf 'TK2M_PRODUCTION_DEPLOY_PROVEN request=%s sha=%s\n' "$request" "$sha"
    printf 'TK2M_PRODUCTION_DEPLOY_REQUIRES_CONTROL_HOLD\n'
    exit 0
  fi
  sleep 5
done
fail "hosted release could not be proved; review driver rollback and live status; signal HOLD"
