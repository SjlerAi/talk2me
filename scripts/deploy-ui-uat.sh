#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${TALK2ME_UI_UAT_REPO:-/home/uent/repositories/talk2me-ui-uat}"
EXPECTED_BRANCH="${TALK2ME_UI_UAT_DEPLOY_BRANCH:?release branch required}"
EXPECTED_SHA="${TALK2ME_UI_UAT_EXPECTED_SHA:?exact SHA required}"
APP_DIR=/home/uent/public_html/talk2me
APP_ROOT=public_html/talk2me
BACKUP_DIR=/home/uent/deployment-backups/talk2me-ui-uat
SITE_URL=https://uent.co.za/talk2me

fail(){ echo "TALK2ME_UI_UAT_DEPLOY_FAILED: $*" >&2; exit 1; }

[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "invalid expected SHA"
[[ "$EXPECTED_BRANCH" == release/* ]] || fail "deployment branch must be release/*"
[ -d "$REPO_ROOT/.git" ] || fail "deployment checkout missing"
[ -d "$APP_DIR" ] || fail "application root missing"
cd "$REPO_ROOT"
[ "$(git rev-parse --show-toplevel)" = "$REPO_ROOT" ] || fail "repository root mismatch"
[ "$(git branch --show-current)" = "$EXPECTED_BRANCH" ] || fail "release branch mismatch"
[ "$(git rev-parse HEAD)" = "$EXPECTED_SHA" ] || fail "exact SHA mismatch"
git diff --quiet || fail "deployment checkout has unstaged changes"
git diff --cached --quiet || fail "deployment checkout has staged changes"

current_lock=""
if [ -f "$APP_DIR/package-lock.json" ]; then
  current_lock="$(sha256sum "$APP_DIR/package-lock.json" | awk '{print $1}')"
fi
new_lock="$(sha256sum "$REPO_ROOT/package-lock.json" | awk '{print $1}')"
[ -n "$current_lock" ] || fail "active dependency lock unavailable"
[ "$current_lock" = "$new_lock" ] || fail "package-lock changed; dependency maintenance must be separately commissioned before deploy"
[ -f "$APP_DIR/node_modules/express/package.json" ] || fail "active express dependency missing"
[ -f "$APP_DIR/node_modules/mysql2/package.json" ] || fail "active mysql2 dependency missing"
[ -f "$APP_DIR/node_modules/ejs/package.json" ] || fail "active ejs dependency missing"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SHORT_SHA="$(printf '%s' "$EXPECTED_SHA" | cut -c1-12)"
BACKUP_FILE="$BACKUP_DIR/talk2me-ui-uat-before-$SHORT_SHA-$STAMP.tar.gz"
STAGE="$(mktemp -d /home/uent/talk2me-ui-uat-stage.XXXXXX)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cleanup(){ rm -rf "$STAGE"; }
trap cleanup EXIT INT TERM

git archive "$EXPECTED_SHA" server.js package.json package-lock.json public src views scripts | tar -x -C "$STAGE"
for required in server.js package.json package-lock.json public src views scripts; do
  [ -e "$STAGE/$required" ] || fail "release missing $required"
done

python3 - "$STAGE/.talk2me-release.json" "$EXPECTED_SHA" "$EXPECTED_BRANCH" "$RELEASE_TIME" "$new_lock" <<'PY'
import json,sys
path,sha,branch,released,dep=sys.argv[1:]
with open(path,'w',encoding='utf-8') as f:
    json.dump({
      "schema":1,
      "service":"talk2me-crm",
      "repository":"SjlerAi/talk2me",
      "environment":"ui-uat",
      "commit":sha,
      "sourceBranch":branch,
      "releaseTime":released,
      "dependencyHash":dep
    },f,indent=2)
    f.write("\n")
PY

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
tar -tzf "$BACKUP_FILE" >/dev/null
chmod 600 "$BACKUP_FILE"

ACTIVATION_STARTED=false
rollback(){
  code=$?
  trap - ERR
  set +e
  if [ "$ACTIVATION_STARTED" = true ]; then
    echo "Talk2Me UI UAT activation failed; restoring previous release." >&2
    for target in "${targets[@]}"; do rm -rf "$APP_DIR/$target"; done
    tar -xzf "$BACKUP_FILE" -C "$APP_DIR"
    mkdir -p "$APP_DIR/tmp"
    touch "$APP_DIR/tmp/restart.txt"
  fi
  exit "$code"
}
trap rollback ERR

ACTIVATION_STARTED=true
for target in "${targets[@]}"; do
  rm -rf "$APP_DIR/$target"
  cp -a "$STAGE/$target" "$APP_DIR/$target"
done

printf '%s\n' "$EXPECTED_SHA" > "$APP_DIR/.deployed_commit"
mkdir -p "$APP_DIR/tmp"
touch "$APP_DIR/tmp/restart.txt"

SELECTOR="$(command -v cloudlinux-selector || true)"
if [ -z "$SELECTOR" ] && [ -x /usr/sbin/cloudlinux-selector ]; then SELECTOR=/usr/sbin/cloudlinux-selector; fi
if [ -n "$SELECTOR" ]; then
  "$SELECTOR" restart --json --interpreter nodejs --app-root "$APP_ROOT" >/tmp/talk2me-ui-uat-selector.json 2>&1 || true
  cat /tmp/talk2me-ui-uat-selector.json 2>/dev/null || true
fi

proved=false
for attempt in $(seq 1 24); do
  health="$(curl -LfsS --connect-timeout 8 --max-time 18 "$SITE_URL/api/health" 2>/dev/null || true)"
  release="$(curl -LfsS --connect-timeout 8 --max-time 18 "$SITE_URL/api/release" 2>/dev/null || true)"
  if HEALTH="$health" RELEASE="$release" EXPECTED_SHA="$EXPECTED_SHA" python3 - <<'PY'
import json,os
try:
    h=json.loads(os.environ.get("HEALTH","{}"))
    r=json.loads(os.environ.get("RELEASE","{}"))
except Exception:
    raise SystemExit(1)
ok=(h.get("status")=="ok" and h.get("database")=="connected" and h.get("environment")=="uat" and
    r.get("environment")=="uat" and r.get("commit")==os.environ["EXPECTED_SHA"])
raise SystemExit(0 if ok else 1)
PY
  then
    proved=true
    break
  fi
  sleep 5
done
[ "$proved" = true ] || fail "exact public release proof failed"

widgets="$(curl -LfsS --connect-timeout 8 --max-time 18 "$SITE_URL/api/uat/widgets/health" 2>/dev/null || true)"
WIDGETS="$widgets" python3 - <<'PY'
import json,os
w=json.loads(os.environ.get("WIDGETS","{}"))
if not (w.get("status")=="ok" and w.get("environment")=="uat" and w.get("database")=="connected"):
    raise SystemExit(1)
PY

agent_login="$(curl -LfsS --connect-timeout 8 --max-time 18 "$SITE_URL/agent/login" 2>/dev/null || true)"
printf '%s' "$agent_login" | grep -Fq 'Gerda Agent' || fail "Gerda Agent login runtime proof failed"

trap - ERR
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'talk2me-ui-uat-before-*.tar.gz' -printf '%T@ %p\n' | sort -nr | tail -n +6 | cut -d' ' -f2- | xargs -r rm -f

echo "TALK2ME_UI_UAT_RESULT=COMPLETE"
echo "PUBLIC_URL=$SITE_URL"
echo "EXPECTED_SHA=$EXPECTED_SHA"
echo "SOURCE_BRANCH=$EXPECTED_BRANCH"
