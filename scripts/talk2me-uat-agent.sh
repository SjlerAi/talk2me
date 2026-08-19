#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_DIR=/home/uent/talk2me-deploy-control
CONTROL_BRANCH=deploy/uat-control
MANIFEST="$CONTROL_DIR/deploy/uat.json"
STATE_DIR=/home/uent/.talk2me-deploy
INBOX_DIR=/home/uent/.config/talk2me/inbox
DRIVER=/home/uent/bin/talk2me-deploy-uat
NODE_BIN=/opt/alt/alt-nodejs20/root/usr/bin/node
LOCK_DIR="$STATE_DIR/agent.lock"

mkdir -p "$STATE_DIR" "$INBOX_DIR"

if [ "${1:-}" = "--status" ]; then
  status=UNKNOWN
  [ -f "$MANIFEST" ] && status="$($NODE_BIN -e "try{process.stdout.write(String(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).status||'UNKNOWN'))}catch{process.stdout.write('INVALID')}" "$MANIFEST")"
  echo "Talk2Me UAT agent installed; control=$status"
  exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$(date -Is) another agent run is active"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

git -C "$CONTROL_DIR" fetch --quiet origin "$CONTROL_BRANCH:refs/remotes/origin/$CONTROL_BRANCH"
git -C "$CONTROL_DIR" reset --quiet --hard "origin/$CONTROL_BRANCH"

eval "$($NODE_BIN - "$MANIFEST" <<'NODE'
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const quote = value => `'${String(value ?? '').replace(/'/g, `'"'"'`)}'`;
for (const key of ['status','repository','environment','commit','workflowRunId','artifact','sha256']) {
  console.log(`${key.toUpperCase()}=${quote(manifest[key])}`);
}
NODE
)"

if [ "$STATUS" = HOLD ]; then
  exit 0
fi

test "$STATUS" = DEPLOY
test "$REPOSITORY" = SjlerAi/talk2me
test "$ENVIRONMENT" = uat
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$WORKFLOWRUNID" =~ ^[0-9]+$ ]]
[[ "$SHA256" =~ ^[0-9a-f]{64}$ ]]
expected_artifact="talk2me-${COMMIT}-${WORKFLOWRUNID}.tar.gz"
test "$ARTIFACT" = "$expected_artifact"

request_id="${COMMIT}-${WORKFLOWRUNID}"
if [ -f "$STATE_DIR/last-request.json" ]; then
  previous="$($NODE_BIN -e "try{const v=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(v.requestId||'')}catch{}" "$STATE_DIR/last-request.json")"
  previous_status="$($NODE_BIN -e "try{const v=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(v.status||'')}catch{}" "$STATE_DIR/last-request.json")"
  if [ "$previous" = "$request_id" ] && [ "$previous_status" = FAILED ]; then
    echo "$(date -Is) request $request_id already failed; waiting for a new manifest"
    exit 1
  fi
fi

artifact_path="$INBOX_DIR/$ARTIFACT"
checksum_path="$artifact_path.sha256"
if [ ! -f "$artifact_path" ] || [ ! -f "$checksum_path" ]; then
  echo "$(date -Is) request $request_id is waiting for its artifact"
  exit 0
fi

write_request() {
  REQUEST_STATUS="$1" REQUEST_MESSAGE="$2" REQUEST_ID="$request_id" REQUEST_COMMIT="$COMMIT" REQUEST_RUN="$WORKFLOWRUNID" "$NODE_BIN" - "$STATE_DIR/last-request.json" <<'NODE'
const fs = require('fs');
fs.writeFileSync(process.argv[2], JSON.stringify({ requestId: process.env.REQUEST_ID, status: process.env.REQUEST_STATUS, commit: process.env.REQUEST_COMMIT, workflowRunId: process.env.REQUEST_RUN, message: process.env.REQUEST_MESSAGE, recordedAt: new Date().toISOString() }, null, 2) + '\n');
NODE
}

write_request RUNNING 'Deployment started'
echo "$(date -Is) deploying $request_id"
if "$DRIVER" "$artifact_path" "$checksum_path" "$COMMIT" "$WORKFLOWRUNID" "$SHA256"; then
  write_request SUCCEEDED 'Exact release activated and verified'
  cp "$STATE_DIR/last-request.json" "$STATE_DIR/last-success.json"
  echo "$(date -Is) deployment $request_id succeeded"
else
  code=$?
  write_request FAILED "Deployment driver exited with code $code"
  echo "$(date -Is) deployment $request_id failed with code $code" >&2
  exit "$code"
fi
