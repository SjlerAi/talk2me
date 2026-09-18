#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_DIR=/home/uent/talk2me-ui-uat-deploy-control
CONTROL_BRANCH=deploy/ui-uat-control
CONTROL_PATH=deploy/ui-uat.json
MANIFEST="$CONTROL_DIR/$CONTROL_PATH"
SOURCE_REPO=/home/uent/repositories/talk2me-ui-uat
STATE_DIR=/home/uent/.talk2me-ui-uat-deploy
DRIVER=/home/uent/bin/talk2me-deploy-ui-uat
LOCK_DIR="$STATE_DIR/lock"
LOCK_PID="$LOCK_DIR/pid"
LAST_SUCCESS="$STATE_DIR/last-success.json"
LOG_DIR="$STATE_DIR/logs"

fail(){ echo "TALK2ME_UI_UAT_AGENT_FAILED: $*" >&2; exit 1; }

mkdir -p "$STATE_DIR" "$LOG_DIR"
chmod 700 "$STATE_DIR" "$LOG_DIR"

ARG1="${1-}"
if [ "$ARG1" = "--status" ]; then
  action=UNKNOWN
  if [ -f "$MANIFEST" ]; then
    action="$(python3 - "$MANIFEST" <<'PY'
import json,sys
try:
    print(json.load(open(sys.argv[1],encoding='utf-8')).get('action','UNKNOWN'))
except Exception:
    print('INVALID')
PY
)"
  fi
  echo "Talk2Me UI UAT agent installed; control=$action"
  exit 0
fi

acquire_lock(){
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_PID"
    return 0
  fi
  holder=""
  [ -f "$LOCK_PID" ] && holder="$(cat "$LOCK_PID" 2>/dev/null || true)"
  if [[ "$holder" =~ ^[0-9]+$ ]] && kill -0 "$holder" 2>/dev/null; then
    echo "TALK2ME_UI_UAT_AGENT_RESULT=BUSY"
    return 1
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  printf '%s\n' "$$" > "$LOCK_PID"
}

if ! acquire_lock; then exit 0; fi
trap 'rm -rf "$LOCK_DIR" 2>/dev/null || true' EXIT

[ -d "$CONTROL_DIR/.git" ] || fail "control checkout missing"
[ -d "$SOURCE_REPO/.git" ] || fail "source checkout missing"
[ -x "$DRIVER" ] || fail "installed deploy driver missing"

for repo_path in "$CONTROL_DIR" "$SOURCE_REPO"; do
  git -C "$repo_path" diff --quiet || fail "dirty checkout: $repo_path"
  git -C "$repo_path" diff --cached --quiet || fail "staged changes in checkout: $repo_path"
done

git -C "$CONTROL_DIR" fetch --quiet --prune origin "$CONTROL_BRANCH"
CONTROL_SHA="$(git -C "$CONTROL_DIR" rev-parse FETCH_HEAD)"
MANIFEST_JSON="$(git -C "$CONTROL_DIR" show "$CONTROL_SHA:$CONTROL_PATH" 2>/dev/null)" || fail "control manifest unavailable"

PARSED="$(python3 -c '
import json,re,sys
m=json.load(sys.stdin)
if m.get("version") != 1: raise SystemExit("invalid version")
if m.get("environment") != "ui-uat": raise SystemExit("invalid environment")
a=m.get("action")
if a not in ("hold","deploy"): raise SystemExit("invalid action")
r=str(m.get("requestId",""))
if not re.fullmatch(r"[A-Za-z0-9._:-]{1,120}",r): raise SystemExit("invalid requestId")
sha=""; branch=""
if a=="deploy":
    sha=str(m.get("sourceSha","")); branch=str(m.get("sourceBranch",""))
    if not re.fullmatch(r"[0-9a-f]{40}",sha): raise SystemExit("invalid sourceSha")
    if not branch.startswith("release/"): raise SystemExit("sourceBranch must be controlled release/*")
print("\x1f".join((a,sha,branch,r)))
' <<< "$MANIFEST_JSON")" || fail "control manifest failed validation"

IFS=$'\x1f' read -r ACTION SOURCE_SHA SOURCE_BRANCH REQUEST_ID <<< "$PARSED"

if [ "$ACTION" = hold ]; then
  echo "TALK2ME_UI_UAT_AGENT_RESULT=HOLD"
  echo "CONTROL_SHA=$CONTROL_SHA"
  echo "REQUEST_ID=$REQUEST_ID"
  exit 0
fi

if [ -f "$LAST_SUCCESS" ] && python3 - "$LAST_SUCCESS" "$REQUEST_ID" "$SOURCE_SHA" <<'PY'
import json,sys
try: m=json.load(open(sys.argv[1],encoding='utf-8'))
except Exception: raise SystemExit(1)
raise SystemExit(0 if m.get('requestId')==sys.argv[2] and m.get('sourceSha')==sys.argv[3] else 1)
PY
then
  echo "TALK2ME_UI_UAT_AGENT_RESULT=ALREADY_DEPLOYED"
  echo "REQUEST_ID=$REQUEST_ID"
  echo "SOURCE_SHA=$SOURCE_SHA"
  exit 0
fi

git -C "$SOURCE_REPO" fetch --quiet --prune origin "$SOURCE_BRANCH"
[ "$(git -C "$SOURCE_REPO" rev-parse FETCH_HEAD)" = "$SOURCE_SHA" ] || fail "controlled release branch does not resolve to requested SHA"
git -C "$SOURCE_REPO" checkout -q -B "$SOURCE_BRANCH" "$SOURCE_SHA"
[ "$(git -C "$SOURCE_REPO" rev-parse HEAD)" = "$SOURCE_SHA" ] || fail "failed to pin exact source SHA"
[ "$(git -C "$SOURCE_REPO" branch --show-current)" = "$SOURCE_BRANCH" ] || fail "failed to activate controlled release branch"

LOG_FILE="$LOG_DIR/$(printf '%s' "$REQUEST_ID" | tr ':' '_').log"
TALK2ME_UI_UAT_REPO="$SOURCE_REPO" TALK2ME_UI_UAT_DEPLOY_BRANCH="$SOURCE_BRANCH" TALK2ME_UI_UAT_EXPECTED_SHA="$SOURCE_SHA" "$DRIVER" 2>&1 | tee "$LOG_FILE"
chmod 600 "$LOG_FILE"

python3 - "$LAST_SUCCESS" "$REQUEST_ID" "$SOURCE_SHA" "$SOURCE_BRANCH" "$CONTROL_SHA" <<'PY'
import json,sys,datetime,os
path,request_id,sha,branch,control_sha=sys.argv[1:]
data={"version":1,"requestId":request_id,"sourceSha":sha,"sourceBranch":branch,"controlSha":control_sha,"deployedAt":datetime.datetime.now(datetime.timezone.utc).isoformat()}
with open(path,'w',encoding='utf-8') as f:
    json.dump(data,f,indent=2); f.write('\n')
os.chmod(path,0o600)
PY

echo "TALK2ME_UI_UAT_AGENT_RESULT=DEPLOYED"
echo "REQUEST_ID=$REQUEST_ID"
echo "SOURCE_SHA=$SOURCE_SHA"
echo "CONTROL_SHA=$CONTROL_SHA"
