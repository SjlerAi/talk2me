#!/bin/bash

set -Eeuo pipefail

REPO_DIR="/home/uent/repositories/talk2me"
DEPLOY_DIR="/home/uent/talk2me.uent.co.za"
BACKUP_DIR="/home/uent/deployment-backups/talk2me"
SITE_URL="https://talk2me.uent.co.za"

NPM_BIN="/opt/alt/alt-nodejs20/root/usr/bin/npm"

MARKER_FILE="$DEPLOY_DIR/.deployed_commit"
DRY_RUN=false

export UV_THREADPOOL_SIZE=2
export PATH="/opt/alt/alt-nodejs20/root/usr/bin:$PATH"

usage() {
    echo "Usage:"
    echo "  ./deploy.sh"
    echo "  ./deploy.sh --dry-run"
}

if [ "$#" -gt 1 ]; then
    usage
    exit 1
fi

if [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=true
elif [ -n "${1:-}" ]; then
    echo "ERROR: Unknown option: $1"
    usage
    exit 1
fi

is_protected() {
    local path="$1"

    case "$path" in
        .htaccess|.env|.deployed_commit)
            return 0
            ;;
        stderr.log|stdout.log|digest.log)
            return 0
            ;;
        node_modules|node_modules/*)
            return 0
            ;;
        tmp|tmp/*)
            return 0
            ;;
        private_uploads|private_uploads/*)
            return 0
            ;;
        .well-known|.well-known/*)
            return 0
            ;;
    esac

    return 1
}

is_safe_path() {
    local path="$1"

    case "$path" in
        ""|/*|../*|*/../*|*/..)
            return 1
            ;;
    esac

    return 0
}

cleanup() {
    if [ -n "${WORK_DIR:-}" ] && [ -d "$WORK_DIR" ]; then
        rm -rf "$WORK_DIR"
    fi
}

trap cleanup EXIT

echo "========================================"
echo " Talk2Me incremental deployment"
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
    echo "ERROR: Deployments must be made from the main branch."
    echo "Current branch: $CURRENT_BRANCH"
    exit 1
fi

PREVIOUS_COMMIT=""

if [ -f "$MARKER_FILE" ]; then
    PREVIOUS_COMMIT="$(tr -d '[:space:]' < "$MARKER_FILE" 2>/dev/null || true)"
fi

echo "Repository:      $REPO_DIR"
echo "Deployment:      $DEPLOY_DIR"
echo "Branch:          $CURRENT_BRANCH"
echo "Current commit:  $SHORT_COMMIT"
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

WORK_DIR="$(mktemp -d)"
RAW_CHANGED="$WORK_DIR/raw-changed.txt"
RAW_DELETED="$WORK_DIR/raw-deleted.txt"
CHANGED_FILE="$WORK_DIR/changed.txt"
DELETED_FILE="$WORK_DIR/deleted.txt"
BACKUP_LIST="$WORK_DIR/backup.txt"

: > "$RAW_CHANGED"
: > "$RAW_DELETED"
: > "$CHANGED_FILE"
: > "$DELETED_FILE"
: > "$BACKUP_LIST"

if [ -n "$PREVIOUS_COMMIT" ] &&
   git cat-file -e "$PREVIOUS_COMMIT^{commit}" 2>/dev/null; then

    git diff --no-renames --name-only --diff-filter=ACMRTUXB \
        "$PREVIOUS_COMMIT" "$CURRENT_COMMIT" > "$RAW_CHANGED"

    git diff --no-renames --name-only --diff-filter=D \
        "$PREVIOUS_COMMIT" "$CURRENT_COMMIT" > "$RAW_DELETED"
else
    echo "NOTICE: A valid previous deployment commit was not found."
    echo "All tracked, non-protected application files will be deployed."
    echo

    git ls-tree -r --name-only "$CURRENT_COMMIT" > "$RAW_CHANGED"
fi

echo "Files to deploy:"
echo

while IFS= read -r path || [ -n "$path" ]; do
    [ -n "$path" ] || continue

    if ! is_safe_path "$path"; then
        echo "SKIP unsafe path: $path"
        continue
    fi

    if is_protected "$path"; then
        echo "SKIP protected:   $path"
        continue
    fi

    if ! git cat-file -e "$CURRENT_COMMIT:$path" 2>/dev/null; then
        echo "SKIP unavailable: $path"
        continue
    fi

    printf '%s\n' "$path" >> "$CHANGED_FILE"
    echo "DEPLOY:           $path"
done < "$RAW_CHANGED"

while IFS= read -r path || [ -n "$path" ]; do
    [ -n "$path" ] || continue

    if ! is_safe_path "$path"; then
        echo "SKIP unsafe path: $path"
        continue
    fi

    if is_protected "$path"; then
        echo "SKIP protected:   $path"
        continue
    fi

    printf '%s\n' "$path" >> "$DELETED_FILE"
    echo "DELETE:           $path"
done < "$RAW_DELETED"

CHANGED_COUNT="$(wc -l < "$CHANGED_FILE" | tr -d ' ')"
DELETED_COUNT="$(wc -l < "$DELETED_FILE" | tr -d ' ')"

echo
echo "Deploy files: $CHANGED_COUNT"
echo "Delete files: $DELETED_COUNT"
echo

if [ "$DRY_RUN" = true ]; then
    echo "========================================"
    echo " DRY RUN COMPLETE"
    echo "========================================"
    echo "No live files were changed."
    echo
    echo "Review the list above carefully."
    echo "Run ./deploy.sh only after approving this dry run."
    exit 0
fi

if [ "$CHANGED_COUNT" -eq 0 ] && [ "$DELETED_COUNT" -eq 0 ]; then
    echo "No deployable application files changed."
    echo "Updating deployment marker only."
    printf '%s\n' "$CURRENT_COMMIT" > "$MARKER_FILE"
    exit 0
fi

PACKAGE_CHANGED=false

while IFS= read -r path || [ -n "$path" ]; do
    case "$path" in
        package.json|package-lock.json|npm-shrinkwrap.json)
            PACKAGE_CHANGED=true
            ;;
    esac
done < "$CHANGED_FILE"

while IFS= read -r path || [ -n "$path" ]; do
    case "$path" in
        package.json|package-lock.json|npm-shrinkwrap.json)
            PACKAGE_CHANGED=true
            ;;
    esac
done < "$DELETED_FILE"

while IFS= read -r path || [ -n "$path" ]; do
    [ -n "$path" ] || continue

    if [ -e "$DEPLOY_DIR/$path" ] || [ -L "$DEPLOY_DIR/$path" ]; then
        printf '%s\n' "$path" >> "$BACKUP_LIST"
    fi
done < "$CHANGED_FILE"

while IFS= read -r path || [ -n "$path" ]; do
    [ -n "$path" ] || continue

    if [ -e "$DEPLOY_DIR/$path" ] || [ -L "$DEPLOY_DIR/$path" ]; then
        if ! grep -Fxq "$path" "$BACKUP_LIST"; then
            printf '%s\n' "$path" >> "$BACKUP_LIST"
        fi
    fi
done < "$DELETED_FILE"

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_FILE="$BACKUP_DIR/talk2me-before-$SHORT_COMMIT-$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "Creating incremental backup..."

if [ -s "$BACKUP_LIST" ]; then
    tar -czf "$BACKUP_FILE" -C "$DEPLOY_DIR" --files-from="$BACKUP_LIST"
else
    tar -czf "$BACKUP_FILE" --files-from=/dev/null
fi

echo "Backup created:"
echo "$BACKUP_FILE"
echo

if [ "$DELETED_COUNT" -gt 0 ]; then
    echo "Removing files deleted from Git..."

    while IFS= read -r path || [ -n "$path" ]; do
        [ -n "$path" ] || continue

        target="$DEPLOY_DIR/$path"

        if [ -e "$target" ] || [ -L "$target" ]; then
            rm -rf -- "$target"
            echo "Removed: $path"
        else
            echo "Already absent: $path"
        fi
    done < "$DELETED_FILE"

    echo
fi

if [ "$CHANGED_COUNT" -gt 0 ]; then
    echo "Deploying changed files only..."

    while IFS= read -r path || [ -n "$path" ]; do
        [ -n "$path" ] || continue

        target="$DEPLOY_DIR/$path"
        parent="$(dirname "$target")"

        mkdir -p "$parent"

        if [ -e "$target" ] || [ -L "$target" ]; then
            rm -rf -- "$target"
        fi
    done < "$CHANGED_FILE"

    mapfile -t CHANGED_PATHS < "$CHANGED_FILE"

    git checkout-index \
        --force \
        --prefix="$DEPLOY_DIR/" \
        -- "${CHANGED_PATHS[@]}"

    while IFS= read -r path || [ -n "$path" ]; do
        [ -n "$path" ] || continue
        echo "Deployed: $path"
    done < "$CHANGED_FILE"

    echo
fi

if [ "$PACKAGE_CHANGED" = true ]; then
    echo "Package configuration changed."
    echo "Installing production dependencies with UV_THREADPOOL_SIZE=2..."

    cd "$DEPLOY_DIR"

    timeout 180s "$NPM_BIN" install \
        --omit=dev \
        --no-audit \
        --no-fund

    cd "$REPO_DIR"
else
    echo "Package configuration unchanged."
    echo "Dependency installation skipped."
fi

echo
echo "Restarting Passenger application..."

mkdir -p "$DEPLOY_DIR/tmp"
touch "$DEPLOY_DIR/tmp/restart.txt"

echo "Waiting for the application to restart..."
sleep 8

echo
echo "Checking website: $SITE_URL"

if curl -LfsS \
    --connect-timeout 10 \
    --max-time 25 \
    "$SITE_URL" >/dev/null; then

    echo "Website check passed."
else
    echo
    echo "ERROR: Website verification failed."
    echo "The deployment marker was NOT updated."
    echo
    echo "Backup available at:"
    echo "$BACKUP_FILE"
    echo
    echo "Review stderr.log, stdout.log and the cPanel application logs."
    exit 1
fi

printf '%s\n' "$CURRENT_COMMIT" > "$MARKER_FILE"

echo
echo "Deployment marker updated:"
echo "$CURRENT_COMMIT"

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
echo "Backup:  $BACKUP_FILE"
