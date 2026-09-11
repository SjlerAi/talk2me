#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_DIR=/home/uent/talk2me-ui-uat-deploy-control
CONTROL_BRANCH=deploy/ui-uat-control
MANIFEST="$CONTROL_DIR/deploy/ui-uat.json"
STATE_DIR=/home/uent/.talk2me-ui-uat-deploy
INBOX_DIR=/home/uent/.config/talk2me-ui-uat/inbox
DRIVER=/home/uent/bin/talk2me-deploy-ui-uat
LOCK_DIR="$STATE_DIR/agent.lock"

mkdir -p "$STATE_DIR" "$INBOX_DIR"
chmod 700 "$STATE_DIR" "$INBOX_DIR"

json_string() {
  key="$1" file="$2"
  sed -n "s/^[[:space:]]*\"${key}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" | head -n 1
}

json_scalar() {
  key="$1" file="$2"
  sed -n "s/^[[:space:]]*\"${key}\"[[:space:]]*:[[:space:]]*\([^,[:space:]]*\).*/\1/p" "$file" | head -n 1 | tr -d '"'
}

if [ "${1:-}" = "--status" ]; then
  status=UNKNOWN
  if [ -f "$MANIFEST" ]; then
    status="$(json_string status "$MANIFEST")"
    [ -n "$status" ] || status=INVALID
  fi
  echo "Talk2Me UI UAT agent installed; control=$status"
  exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$(date -Is) another UI UAT agent run is active"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

git -C "$CONTROL_DIR" fetch --quiet origin "$CONTROL_BRANCH:refs/remotes/origin/$CONTROL_BRANCH"
git -C "$CONTROL_DIR" reset --quiet --hard "origin/$CONTROL_BRANCH"

test -f "$MANIFEST"
STATUS="$(json_string status "$MANIFEST")"
REPOSITORY="$(json_string repository "$MANIFEST")"
ENVIRONMENT="$(json_string environment "$MANIFEST")"
COMMIT="$(json_string commit "$MANIFEST")"
WORKFLOWRUNID="$(json_scalar workflowRunId "$MANIFEST")"
ARTIFACT="$(json_string artifact "$MANIFEST")"
SHA256="$(json_string sha256 "$MANIFEST")"

if [ "$STATUS" = HOLD ]; then
  exit 0
fi

test "$STATUS" = DEPLOY
test "$REPOSITORY" = SjlerAi/talk2me
test "$ENVIRONMENT" = ui-uat
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$WORKFLOWRUNID" =~ ^[0-9]+$ ]]
[[ "$SHA256" =~ ^[0-9a-f]{64}$ ]]
expected_artifact="talk2me-ui-uat-${COMMIT}-${WORKFLOWRUNID}.tar.gz"
test "$ARTIFACT" = "$expected_artifact"

request_id="${COMMIT}-${WORKFLOWRUNID}"
if [ -f "$STATE_DIR/last-request.json" ]; then
  previous="$(json_string requestId "$STATE_DIR/last-request.json")"
  previous_status="$(json_string status "$STATE_DIR/last-request.json")"
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
  request_status="$1"
  request_message="$2"
  recorded_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  cat > "$STATE_DIR/last-request.json" <<JSON
{
  "requestId": "$request_id",
  "status": "$request_status",
  "commit": "$COMMIT",
  "workflowRunId": "$WORKFLOWRUNID",
  "message": "$request_message",
  "recordedAt": "$recorded_at"
}
JSON
  chmod 600 "$STATE_DIR/last-request.json"
}

write_request RUNNING 'UI UAT deployment started'
echo "$(date -Is) deploying UI UAT $request_id"
if "$DRIVER" "$artifact_path" "$checksum_path" "$COMMIT" "$WORKFLOWRUNID" "$SHA256"; then
  write_request SUCCEEDED 'Exact UI UAT release activated and verified'
  cp "$STATE_DIR/last-request.json" "$STATE_DIR/last-success.json"
  chmod 600 "$STATE_DIR/last-success.json"
  echo "$(date -Is) UI UAT deployment $request_id succeeded"
else
  code=$?
  write_request FAILED "UI UAT deployment driver exited with code $code"
  echo "$(date -Is) UI UAT deployment $request_id failed with code $code" >&2
  exit "$code"
fi
