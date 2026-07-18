#!/bin/bash

set -Eeuo pipefail

REPO_DIR="/home/uent/repositories/talk2me"
DEPLOY_DIR="/home/uent/talk2me.uent.co.za"
BACKUP_DIR="/home/uent/deployment-backups/talk2me"
SITE_URL="https://talk2me.uent.co.za"

NODE_BIN="/opt/alt/alt-nodejs20/root/usr/bin/node"
NPM_BIN="/opt/alt/alt-nodejs20/root/usr/bin/npm"

MARKER_FILE="$DEPLOY_DIR/.deployed_commit"
DRY_RUN=false

if [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=true
fi

echo "========================================"
echo " Talk2Me deployment"
echo "========================================"
echo

cd "$REPO_DIR"

if [ ! -d ".git" ]; then
    echo "ERROR: $REPO_DIR is not a Git repository."
    exit 1
fi

if [ ! -d "$DEPLOY_DIR" ]; then
    echo "ERROR: Deployment directory does not exist:"
    echo "$DEPLOY_DIR"
    exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: The Git repository contains uncommitted changes."
    echo
    git status --short
    echo
    echo "Commit or discard the changes before deploying."
    exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
CURRENT_COMMIT="$(git rev-parse HEAD)"
SHORT_COMMIT="$(git rev-parse --short HEAD)"
COMMIT_MESSAGE="$(git log -1 --pretty=%s)"

if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "ERROR: You are currently on branch '$CURRENT_BRANCH'."
    echo "Deployments must be made from the main branch."
    exit 1
fi

PREVIOUS_COMMIT=""

if [ -f "$MARKER_FILE" ]; then
    PREVIOUS_COMMIT="$(cat "$MARKER_FILE" 2>/dev/null || true)"
fi

echo "Repository:      $REPO_DIR"
echo "Deployment:      $DEPLOY_DIR"
echo "Branch:          $CURRENT_BRANCH"
echo "Commit:          $SHORT_COMMIT"
echo "Description:     $COMMIT_MESSAGE"

if [ -n "$PREVIOUS_COMMIT" ]; then
    echo "Previous deploy: ${PREVIOUS_COMMIT:0:7}"
else
    echo "Previous deploy: Not recorded"
fi

echo

if [ "$PREVIOUS_COMMIT" = "$CURRENT_COMMIT" ]; then
    echo "This commit is already deployed."
    exit 0
fi

echo "Files to deploy:"
echo

if [ -n "$PREVIOUS_COMMIT" ] && git cat-file -e "$PREVIOUS_COMMIT^{commit}" 2>/dev/null; then
    git diff --name-status "$PREVIOUS_COMMIT" "$CURRENT_COMMIT"
else
    git ls-tree -r --name-only "$CURRENT_COMMIT"
fi

echo

if [ "$DRY_RUN" = true ]; then
    echo "DRY RUN COMPLETE"
    echo "No files were changed."
    echo
    echo "Run ./deploy.sh to perform the deployment."
    exit 0
fi

PACKAGE_CHANGED=false

if [ ! -f "$DEPLOY_DIR/package.json" ]; then
    PACKAGE_CHANGED=true
elif ! cmp -s "$REPO_DIR/package.json" "$DEPLOY_DIR/package.json"; then
    PACKAGE_CHANGED=true
fi

if [ -f "$REPO_DIR/package-lock.json" ]; then
    if [ ! -f "$DEPLOY_DIR/package-lock.json" ]; then
        PACKAGE_CHANGED=true
    elif ! cmp -s "$REPO_DIR/package-lock.json" "$DEPLOY_DIR/package-lock.json"; then
        PACKAGE_CHANGED=true
    fi
fi

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_FILE="$BACKUP_DIR/talk2me-before-$SHORT_COMMIT-$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "Creating deployment backup..."
tar \
    --exclude='.env' \
    --exclude='node_modules' \
    --exclude='logs' \
    --exclude='tmp' \
    --exclude='stderr.log' \
    --exclude='stdout.log' \
    --exclude='digest.log' \
    --exclude='.well-known' \
    -czf "$BACKUP_FILE" \
    -C "$DEPLOY_DIR" .

echo "Backup created:"
echo "$BACKUP_FILE"
echo

echo "Deploying committed files..."

git archive --format=tar "$CURRENT_COMMIT" |
    tar -xf - -C "$DEPLOY_DIR"

if [ -n "$PREVIOUS_COMMIT" ] && git cat-file -e "$PREVIOUS_COMMIT^{commit}" 2>/dev/null; then
    echo "Removing files deleted from Git..."

    git diff --name-only --diff-filter=D \
        "$PREVIOUS_COMMIT" "$CURRENT_COMMIT" |
    while IFS= read -r deleted_file; do
        if [ -n "$deleted_file" ]; then
            rm -f "$DEPLOY_DIR/$deleted_file"
            echo "Removed: $deleted_file"
        fi
    done
fi

if [ "$PACKAGE_CHANGED" = true ]; then
    echo
    echo "Package configuration changed."
    echo "Installing production dependencies..."

    cd "$DEPLOY_DIR"

    timeout 180s "$NPM_BIN" install \
        --omit=dev \
        --no-audit \
        --no-fund

    cd "$REPO_DIR"
else
    echo
    echo "Package configuration unchanged."
    echo "Dependency installation skipped."
fi

echo
echo "Restarting the Node application..."

mkdir -p "$DEPLOY_DIR/tmp"
touch "$DEPLOY_DIR/tmp/restart.txt"

printf '%s\n' "$CURRENT_COMMIT" > "$MARKER_FILE"

echo "Waiting for the application to restart..."
sleep 8

echo
echo "Checking website..."

if curl -LfsS --max-time 25 "$SITE_URL" >/dev/null; then
    echo "Website check passed: $SITE_URL"
else
    echo "WARNING: Deployment completed, but the website check failed."
    echo "Check the application in cPanel and review the error logs."
    exit 1
fi

echo
echo "Removing old backups..."
find "$BACKUP_DIR" \
    -maxdepth 1 \
    -type f \
    -name 'talk2me-before-*.tar.gz' \
    -printf '%T@ %p\n' |
    sort -nr |
    tail -n +6 |
    cut -d' ' -f2- |
    xargs -r rm -f

echo
echo "========================================"
echo " Deployment successful"
echo "========================================"
echo "Version: $SHORT_COMMIT"
echo "Commit:  $COMMIT_MESSAGE"
echo "Website: $SITE_URL"
