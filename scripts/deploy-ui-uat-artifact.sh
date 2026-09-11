#!/usr/bin/env bash
set -Eeuo pipefail

ARTIFACT_PATH="${1:?artifact path required}"
CHECKSUM_PATH="${2:?checksum path required}"
EXPECTED_COMMIT="${3:?commit required}"
EXPECTED_RUN_ID="${4:?workflow run id required}"
EXPECTED_SHA256="${5:?sha256 required}"

APP_DIR=/home/uent/public_html/talk2me
BACKUP_DIR=/home/uent/deployment-backups/talk2me-ui-uat
RELEASES_DIR=/home/uent/releases/talk2me-ui-uat
NODE_BIN=/opt/alt/alt-nodejs20/root/usr/bin/node
SITE_URL=https://uent.co.za/talk2me
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
SHORT_COMMIT="${EXPECTED_COMMIT:0:7}"
RELEASE_DIR="$RELEASES_DIR/${EXPECTED_COMMIT}-${EXPECTED_RUN_ID}"
BACKUP_FILE="$BACKUP_DIR/talk2me-ui-uat-before-${SHORT_COMMIT}-${TIMESTAMP}.tar.gz"
OLD_NODE_MODULES="$BACKUP_DIR/node_modules-before-${SHORT_COMMIT}-${TIMESTAMP}"
ACTIVATION_STARTED=false
NODE_MODULES_MOVED=false
NODE_MODULES_REPLACED=false

[[ "$EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$EXPECTED_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]]
test -f "$ARTIFACT_PATH"
test -f "$CHECKSUM_PATH"
test -d "$APP_DIR"
test -x "$NODE_BIN"
test "$($NODE_BIN --version | cut -d. -f1)" = v20

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

"$NODE_BIN" - "$RELEASE_DIR/.talk2me-release.json" "$EXPECTED_COMMIT" "$EXPECTED_RUN_ID" <<'NODE'
const fs = require('fs');
const [manifestPath, expectedCommit, expectedRun] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (value.schema !== 1 || value.service !== 'talk2me-crm' || value.repository !== 'SjlerAi/talk2me' || value.environment !== 'ui-uat' || value.commit !== expectedCommit || String(value.workflowRunId) !== String(expectedRun)) process.exit(1);
NODE

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
    if [ "$NODE_MODULES_MOVED" = true ]; then mv "$OLD_NODE_MODULES" "$APP_DIR/node_modules"; fi
    mkdir -p "$APP_DIR/tmp"
    touch "$APP_DIR/tmp/restart.txt"
  fi
  exit "$code"
}
trap rollback ERR

current_dependency_hash=""
if [ -f "$APP_DIR/.talk2me-release.json" ]; then
  current_dependency_hash="$($NODE_BIN -e "try{process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).dependencyHash||'')}catch{}" "$APP_DIR/.talk2me-release.json")"
fi
new_dependency_hash="$($NODE_BIN -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).dependencyHash||'')" "$RELEASE_DIR/.talk2me-release.json")"
test -n "$new_dependency_hash"

ACTIVATION_STARTED=true
if [ "$current_dependency_hash" != "$new_dependency_hash" ]; then
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
sleep 8

health="$(curl -LfsS --connect-timeout 10 --max-time 25 "$SITE_URL/api/health")"
release="$(curl -LfsS --connect-timeout 10 --max-time 25 "$SITE_URL/api/release")"
HEALTH="$health" RELEASE="$release" EXPECTED_COMMIT="$EXPECTED_COMMIT" EXPECTED_RUN_ID="$EXPECTED_RUN_ID" "$NODE_BIN" <<'NODE'
const h = JSON.parse(process.env.HEALTH || '{}');
const r = JSON.parse(process.env.RELEASE || '{}');
if (h.status !== 'ok' || h.environment !== 'uat') process.exit(1);
if (r.environment !== 'uat' || r.commit !== process.env.EXPECTED_COMMIT || String(r.workflowRunId) !== String(process.env.EXPECTED_RUN_ID)) process.exit(1);
NODE

trap - ERR
rm -f "$ARTIFACT_PATH" "$CHECKSUM_PATH"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'talk2me-ui-uat-before-*.tar.gz' -printf '%T@ %p\n' | sort -nr | tail -n +6 | cut -d' ' -f2- | xargs -r rm -f
find "$BACKUP_DIR" -maxdepth 1 -type d -name 'node_modules-before-*' -printf '%T@ %p\n' | sort -nr | tail -n +3 | cut -d' ' -f2- | xargs -r rm -rf
find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | tail -n +4 | cut -d' ' -f2- | xargs -r rm -rf
echo "Activated Talk2Me UI UAT release $EXPECTED_COMMIT from workflow $EXPECTED_RUN_ID."
