#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_REPO=/home/uent/repositories/talk2me-ui-uat
CONTROL_DIR=/home/uent/talk2me-ui-uat-deploy-control
STATE_DIR=/home/uent/.talk2me-ui-uat-deploy
INBOX_DIR=/home/uent/.config/talk2me-ui-uat/inbox
BIN_DIR=/home/uent/bin
CONTROL_BRANCH=deploy/ui-uat-control
CRON_MARKER='talk2me-ui-uat-deploy-agent'

test "$(whoami)" = uent
test -d "$SOURCE_REPO/.git"
test -f "$SOURCE_REPO/scripts/talk2me-ui-uat-agent.sh"
test -f "$SOURCE_REPO/scripts/deploy-ui-uat-artifact.sh"

mkdir -p "$BIN_DIR" "$STATE_DIR" "$INBOX_DIR"
chmod 700 "$STATE_DIR" "$INBOX_DIR"
install -m 700 "$SOURCE_REPO/scripts/talk2me-ui-uat-agent.sh" "$BIN_DIR/talk2me-ui-uat-agent"
install -m 700 "$SOURCE_REPO/scripts/deploy-ui-uat-artifact.sh" "$BIN_DIR/talk2me-deploy-ui-uat"

remote_url="$(git -C "$SOURCE_REPO" remote get-url origin)"
if [ -d "$CONTROL_DIR/.git" ]; then
  git -C "$CONTROL_DIR" remote set-url origin "$remote_url"
else
  rm -rf "$CONTROL_DIR"
  git clone --single-branch --branch "$CONTROL_BRANCH" "$remote_url" "$CONTROL_DIR"
fi
git -C "$CONTROL_DIR" fetch origin "$CONTROL_BRANCH:refs/remotes/origin/$CONTROL_BRANCH"
git -C "$CONTROL_DIR" reset --hard "origin/$CONTROL_BRANCH"

existing_cron="$(crontab -l 2>/dev/null || true)"
clean_cron="$(printf '%s\n' "$existing_cron" | grep -Fv "$CRON_MARKER" || true)"
{
  printf '%s\n' "$clean_cron"
  printf '%s\n' '* * * * * /home/uent/bin/talk2me-ui-uat-agent >> /home/uent/.talk2me-ui-uat-deploy/cron.log 2>&1 # talk2me-ui-uat-deploy-agent'
} | sed '/^[[:space:]]*$/d' | crontab -

touch "$STATE_DIR/cron.log"
chmod 600 "$STATE_DIR/cron.log"
"$BIN_DIR/talk2me-ui-uat-agent" --status
echo "Talk2Me UI UAT deployment agent installed."
