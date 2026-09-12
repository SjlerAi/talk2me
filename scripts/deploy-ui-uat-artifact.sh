#!/usr/bin/env bash
set -Eeuo pipefail

ARTIFACT_PATH="${1:?artifact path required}"
CHECKSUM_PATH="${2:?checksum path required}"
EXPECTED_COMMIT="${3:?commit required}"
EXPECTED_RUN_ID="${4:?workflow run id required}"
EXPECTED_SHA256="${5:?sha256 required}"

APP_DIR=/home/uent/public_html/talk2me
APP_ROOT=public_html/talk2me
BACKUP_DIR=/home/uent/deployment-backups/talk2me-ui-uat
RELEASES_DIR=/home/uent/releases/talk2me-ui-uat
SITE_URL=https://uent.co.za/talk2me
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
SHORT_COMMIT="${EXPECTED_COMMIT:0:7}"
RELEASE_DIR="$RELEASES_DIR/${EXPECTED_COMMIT}-${EXPECTED_RUN_ID}"
BACKUP_FILE="$BACKUP_DIR/talk2me-ui-uat-before-${SHORT_COMMIT}-${TIMESTAMP}.tar.gz"
OLD_NODE_MODULES="$BACKUP_DIR/node_modules-before-${SHORT_COMMIT}-${TIMESTAMP}"
ACTIVATION_STARTED=false
NODE_MODULES_MOVED=false
NODE_MODULES_REPLACED=false

json_string() {
  key="$1" file="$2"
  sed -n "s/^[[:space:]]*\"${key}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" | head -n 1
}

json_scalar() {
  key="$1" file="$2"
  sed -n "s/^[[:space:]]*\"${key}\"[[:space:]]*:[[:space:]]*\([^,[:space:]]*\).*/\1/p" "$file" | head -n 1 | tr -d '"'
}

[[ "$EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$EXPECTED_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]]
test -f "$ARTIFACT_PATH"
test -f "$CHECKSUM_PATH"
test -d "$APP_DIR"

actual_sha256="$(sha256sum "$ARTIFACT_PATH" | awk '{print $1}')"
test "$actual_sha256" = "$EXPECTED_SHA256"
grep -Fxq "$EXPECTED_SHA256  $(basename "$ARTIFACT_PATH")" "$CHECKSUM_PATH"

if tar -tzf "$ARTIFACT_PATH" | sed 's#^\./##' | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Unsafe archive path detected." >&2
  exit 1
fi

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR" "$BACKUP_DIR" "$RELEASES_DIR"
tar -xzf "$ARTIFACT_PATH" -C "$RELEASE_DIR"

test -f "$RELEASE_DIR/server.js"
test -f "$RELEASE_DIR/package-lock.json"
test -d "$RELEASE_DIR/public"
test -d "$RELEASE_DIR/src"
test -d "$RELEASE_DIR/views"
test -d "$RELEASE_DIR/node_modules"
test -f "$RELEASE_DIR/.talk2me-release.json"

manifest="$RELEASE_DIR/.talk2me-release.json"
test "$(json_scalar schema "$manifest")" = 1
test "$(json_string service "$manifest")" = talk2me-crm
test "$(json_string repository "$manifest")" = SjlerAi/talk2me
test "$(json_string environment "$manifest")" = ui-uat
test "$(json_string commit "$manifest")" = "$EXPECTED_COMMIT"
test "$(json_string workflowRunId "$manifest")" = "$EXPECTED_RUN_ID"
new_dependency_hash="$(json_string dependencyHash "$manifest")"
[[ "$new_dependency_hash" =~ ^[0-9a-f]{64}$ ]]

# Validate a few production dependencies are physically present in the immutable artifact.
# This catches a broken node_modules package before the live UAT app is touched.
test -f "$RELEASE_DIR/node_modules/express/package.json"
test -f "$RELEASE_DIR/node_modules/mysql2/package.json"
test -f "$RELEASE_DIR/node_modules/ejs/package.json"

# Some older UAT stderr logs refer to helmet although the current Talk2Me package does not use it.
# Do not treat stale stderr as release state; the exact public health/release checks below are authoritative.

targets=(server.js package.json package-lock.json public src views scripts .talk2me-release.json)
backup_targets=()
for target in "${targets[@]}"; do
  [ -e "$APP_DIR/$target" ] && backup_targets+=("$target")
done
if [ "${#backup_targets[@]}" -gt 0 ]; then
  tar -czf "$BACKUP_FILE" -C "$APP_DIR" "${backup_targets[@]}"
else
  tar -czf "$BACKUP_FILE" --files-from=/dev/null
fi

rollback() {
  code=$?
  trap - ERR
  set +e
  if [ "$ACTIVATION_STARTED" = true ]; then
    echo "UI UAT activation failed; restoring previous application release." >&2
    for target in "${targets[@]}"; do rm -rf "$APP_DIR/$target"; done
    tar -xzf "$BACKUP_FILE" -C "$APP_DIR"
    if [ "$NODE_MODULES_REPLACED" = true ]; then rm -rf "$APP_DIR/node_modules"; fi
    if [ "$NODE_MODULES_MOVED" = true ] && [ -d "$OLD_NODE_MODULES" ]; then mv "$OLD_NODE_MODULES" "$APP_DIR/node_modules"; fi
    mkdir -p "$APP_DIR/tmp"
    touch "$APP_DIR/tmp/restart.txt"
  fi
  exit "$code"
}
trap rollback ERR

current_dependency_hash=""
if [ -f "$APP_DIR/.talk2me-release.json" ]; then
  current_dependency_hash="$(json_string dependencyHash "$APP_DIR/.talk2me-release.json")"
fi

ACTIVATION_STARTED=true
if [ "$current_dependency_hash" != "$new_dependency_hash" ] || [ ! -d "$APP_DIR/node_modules" ]; then
  if [ -d "$APP_DIR/node_modules" ]; then
    mv "$APP_DIR/node_modules" "$OLD_NODE_MODULES"
    NODE_MODULES_MOVED=true
  fi
  cp -a "$RELEASE_DIR/node_modules" "$APP_DIR/node_modules"
  NODE_MODULES_REPLACED=true
fi

for target in "${targets[@]}"; do
  rm -rf "$APP_DIR/$target"
  cp -a "$RELEASE_DIR/$target" "$APP_DIR/$target"
done

printf '%s\n' "$EXPECTED_COMMIT" > "$APP_DIR/.deployed_commit"
mkdir -p "$APP_DIR/tmp"
touch "$APP_DIR/tmp/restart.txt"

# Passenger/CloudLinux restart is best effort here. The restart.txt touch above is the
# low-cost canonical restart signal and avoids repeatedly spawning heavyweight helpers.
SELECTOR="$(command -v cloudlinux-selector || true)"
if [ -n "$SELECTOR" ]; then
  "$SELECTOR" restart --json --interpreter nodejs --app-root "$APP_ROOT" >/tmp/talk2me-ui-uat-selector.json 2>&1 || true
  cat /tmp/talk2me-ui-uat-selector.json 2>/dev/null || true
fi

for attempt in $(seq 1 18); do
  health="$(curl -LfsS --connect-timeout 8 --max-time 18 "$SITE_URL/api/health" 2>/dev/null || true)"
  release="$(curl -LfsS --connect-timeout 8 --max-time 18 "$SITE_URL/api/release" 2>/dev/null || true)"

  health_status="$(printf '%s' "$health" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  health_db="$(printf '%s' "$health" | sed -n 's/.*"database"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  health_env="$(printf '%s' "$health" | sed -n 's/.*"environment"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  release_env="$(printf '%s' "$release" | sed -n 's/.*"environment"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  release_commit="$(printf '%s' "$release" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  release_run="$(printf '%s' "$release" | sed -n 's/.*"workflowRunId"[[:space:]]*:[[:space:]]*"\{0,1\}\([0-9]*\)"\{0,1\}.*/\1/p')"

  if [ "$health_status" = ok ] && [ "$health_db" = connected ] && [ "$health_env" = uat ] && [ "$release_env" = uat ] && [ "$release_commit" = "$EXPECTED_COMMIT" ] && [ "$release_run" = "$EXPECTED_RUN_ID" ]; then
    trap - ERR
    rm -f "$ARTIFACT_PATH" "$CHECKSUM_PATH"
    find "$BACKUP_DIR" -maxdepth 1 -type f -name 'talk2me-ui-uat-before-*.tar.gz' -printf '%T@ %p\n' | sort -nr | tail -n +6 | cut -d' ' -f2- | xargs -r rm -f
    find "$BACKUP_DIR" -maxdepth 1 -type d -name 'node_modules-before-*' -printf '%T@ %p\n' | sort -nr | tail -n +3 | cut -d' ' -f2- | xargs -r rm -rf
    find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | tail -n +4 | cut -d' ' -f2- | xargs -r rm -rf
    echo "Activated Talk2Me UI UAT release $EXPECTED_COMMIT from workflow $EXPECTED_RUN_ID."
    exit 0
  fi
  echo "Waiting for UI UAT health (attempt $attempt/18)..."
  sleep 5
done

echo "UI UAT did not become healthy after activation." >&2
exit 1
