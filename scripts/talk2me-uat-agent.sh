#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_DIR=/home/uent/talk2me-deploy-control
CONTROL_BRANCH=deploy/uat-control
MANIFEST="$CONTROL_DIR/deploy/uat.json"
STATE_DIR=/home/uent/.talk2me-deploy
INBOX_DIR=/home/uent/.config/talk2me/inbox
DRIVER=/home/uent/bin/talk2me-deploy-uat
PYTHON_BIN=/usr/bin/python3
MAX_USER_THREADS="${TALK2ME_DEPLOY_MAX_USER_THREADS:-75}"
LOCK_DIR="$STATE_DIR/agent.lock"
LOCK_PID="$LOCK_DIR/pid"

mkdir -p "$STATE_DIR" "$INBOX_DIR"

user_thread_count(){
  ps -u "$(id -un)" -L --no-headers 2>/dev/null | wc -l | tr -d ' '
}

if [ "${1:-}" = "--status" ]; then
  status=UNKNOWN
  if [ -f "$MANIFEST" ]; then
    status="$("$PYTHON_BIN" - "$MANIFEST" <<'PY'
import json,sys
try:
    print(json.load(open(sys.argv[1],encoding='utf-8')).get('status','UNKNOWN'))
except Exception:
    print('INVALID')
PY
)"
  fi
  echo "Talk2Me UAT agent installed; control=$status"
  exit 0
fi

if threads="$(user_thread_count 2>/dev/null)"; then
  if [ "$threads" -gt "$MAX_USER_THREADS" ]; then
    echo "$(date -Is) deployment agent deferred; user_threads=$threads max=$MAX_USER_THREADS"
    exit 0
  fi
fi

acquire_lock(){
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_PID"
    return 0
  fi
  holder=""
  [ -f "$LOCK_PID" ] && holder="$(cat "$LOCK_PID" 2>/dev/null || true)"
  if [[ "$holder" =~ ^[0-9]+$ ]] && kill -0 "$holder" 2>/dev/null; then
    echo "$(date -Is) deployment agent already active as pid $holder"
    return 1
  fi
  echo "$(date -Is) removing stale deployment-agent lock"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  printf '%s\n' "$$" > "$LOCK_PID"
}

if ! acquire_lock; then
  exit 0
fi
trap 'rm -rf "$LOCK_DIR" 2>/dev/null || true' EXIT

git -C "$CONTROL_DIR" fetch --quiet origin "$CONTROL_BRANCH:refs/remotes/origin/$CONTROL_BRANCH"
git -C "$CONTROL_DIR" reset --quiet --hard "origin/$CONTROL_BRANCH"

eval "$("$PYTHON_BIN" - "$MANIFEST" <<'PY'
import json,shlex,sys
manifest=json.load(open(sys.argv[1],encoding='utf-8'))
for key in ['status','repository','environment','commit','workflowRunId','artifact','sha256']:
    value=manifest.get(key,'')
    print(f"{key.upper()}={shlex.quote(str('' if value is None else value))}")
PY
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
  previous="$("$PYTHON_BIN" - "$STATE_DIR/last-request.json" <<'PY'
import json,sys
try:
    v=json.load(open(sys.argv[1],encoding='utf-8'))
    print(str(v.get('requestId','')))
    print(str(v.get('status','')))
except Exception:
    print()
    print()
PY
)"
  previous_id="$(printf '%s\n' "$previous" | sed -n '1p')"
  previous_status="$(printf '%s\n' "$previous" | sed -n '2p')"
  if [ "$previous_id" = "$request_id" ] && [ "$previous_status" = FAILED ]; then
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
  REQUEST_STATUS="$1" REQUEST_MESSAGE="$2" REQUEST_ID="$request_id" REQUEST_COMMIT="$COMMIT" REQUEST_RUN="$WORKFLOWRUNID" \
    "$PYTHON_BIN" - "$STATE_DIR/last-request.json" <<'PY'
import datetime,json,os,sys
data={
  'requestId':os.environ['REQUEST_ID'],
  'status':os.environ['REQUEST_STATUS'],
  'commit':os.environ['REQUEST_COMMIT'],
  'workflowRunId':os.environ['REQUEST_RUN'],
  'message':os.environ['REQUEST_MESSAGE'],
  'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()
}
with open(sys.argv[1],'w',encoding='utf-8') as f:
    json.dump(data,f,indent=2); f.write('\n')
PY
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
