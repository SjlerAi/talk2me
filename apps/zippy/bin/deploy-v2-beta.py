#!/usr/bin/env python3
"""Controlled, low-resource Zippy beta file install.

Never touches the .env, private data, node_modules, Talk2Me, or Passenger
processes. Operator separately verifies database backup and performs one
graceful Zippy-only restart after --apply. Rollback restores all changed files.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path('/home/uent/zippy-app')
CHECKOUT = Path('/home/uent/repositories/zippy-v2-preview-20261022')
STAGED = CHECKOUT / 'apps/zippy'
FILES = (
    'server.js',
    'package.json',
    'src/ai.js',
    'src/crm.js',
    'src/conversation.js',
    'src/crm-intents.js',
    'src/language.js',
    'src/voice-transcribe.js',
    'sql/schema.sql',
    'public/beta/index.html',
    'public/beta/voice-flow.js',
    'public/beta/app.js',
    'public/beta/style.css',
    'public/beta/sw.js',
    'public/beta/manifest.webmanifest',
)
BACKUP_BASE = ROOT / '.rollback-v2-beta-20261022'


def git(*args):
    return subprocess.check_output(['git', '-C', str(CHECKOUT), *args],
                                   timeout=12, stderr=subprocess.DEVNULL).decode().strip()


def blob_hash(data):
    header = ('blob %s\x00' % len(data)).encode('ascii')
    return hashlib.sha1(header + data).hexdigest()


def verify(expected_sha):
    actual = git('rev-parse', 'HEAD')
    if actual != expected_sha:
        raise RuntimeError('Staged SHA mismatch; expected exact tested release')
    if git('status', '--porcelain') != '':
        raise RuntimeError('Staging worktree has uncommitted changes')
    for name in FILES:
        source = STAGED / name
        if not source.is_file():
            raise RuntimeError('Staged file missing: ' + name)
        expected = git('rev-parse', 'HEAD:apps/zippy/' + name)
        if blob_hash(source.read_bytes()) != expected:
            raise RuntimeError('Git blob verification failed: ' + name)
    for name in ('public/index.html', 'public/app.js', 'public/sw.js'):
        current = ROOT / name
        staged_original = STAGED / name
        if not current.is_file() or current.read_bytes() != staged_original.read_bytes():
            raise RuntimeError('Production app changed; refusing to replace it')
    print('ZIPPY_BETA_STAGE_VERIFIED', actual, len(FILES))
    return actual


def apply(expected_sha):
    actual = verify(expected_sha)
    backup = BACKUP_BASE / actual[:12]
    if backup.exists():
        raise RuntimeError('Backup already exists; inspect before retrying')
    backup.mkdir(parents=True, mode=0o700)
    manifest = {}
    for name in FILES:
        previous = ROOT / name
        existed = previous.exists()
        manifest[name] = existed
        if existed:
            dest = backup / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(previous, dest)
    (backup / 'manifest.json').write_text(
        json.dumps({'release_sha': actual, 'existed': manifest}, sort_keys=True),
        encoding='utf-8')
    os.chmod(backup / 'manifest.json', 0o600)
    try:
        for name in FILES:
            source = STAGED / name
            target = ROOT / name
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + '.zippy-v2-staging')
            shutil.copy2(source, temporary)
            os.replace(temporary, target)
            expected = git('rev-parse', 'HEAD:apps/zippy/' + name)
            if blob_hash(target.read_bytes()) != expected:
                raise RuntimeError('Post-copy hash mismatch: ' + name)
    except Exception:
        restore(backup)
        raise
    print('ZIPPY_BETA_FILES_INSTALLED', actual, len(FILES))
    print('ZIPPY_BETA_BACKUP_READY', backup)
    print('NO_RESTART_PERFORMED')


def restore(backup):
    manifest_path = backup / 'manifest.json'
    if not manifest_path.exists():
        raise RuntimeError('Rollback manifest missing')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    for name, existed in manifest['existed'].items():
        target = ROOT / name
        if existed:
            source = backup / name
            if not source.exists():
                raise RuntimeError('Rollback file missing: ' + name)
            temp = target.with_name(target.name + '.zippy-restore')
            shutil.copy2(source, temp)
            os.replace(temp, target)
        elif target.exists():
            target.unlink()
    print('ZIPPY_BETA_FILES_ROLLED_BACK', manifest['release_sha'])
    print('NO_RESTART_PERFORMED')


def installed(expected_sha):
    verify(expected_sha)
    for name in FILES:
        current = ROOT / name
        if not current.is_file():
            raise RuntimeError('Installed file missing: ' + name)
        if blob_hash(current.read_bytes()) != git('rev-parse', 'HEAD:apps/zippy/' + name):
            raise RuntimeError('Installed file does not match tested release: ' + name)
    print('ZIPPY_BETA_INSTALLED_EXACT_SHA', expected_sha)


def main():
    if len(sys.argv) != 3:
        raise RuntimeError('Usage: deploy-v2-beta.py --verify|--apply|--installed|--rollback SHA')
    action, sha = sys.argv[1:]
    if len(sha) != 40 or any(c not in '0123456789abcdef' for c in sha):
        raise RuntimeError('Full 40-character lowercase SHA required')
    if action == '--verify':
        verify(sha)
    elif action == '--apply':
        apply(sha)
    elif action == '--installed':
        installed(sha)
    elif action == '--rollback':
        restore(BACKUP_BASE / sha[:12])
    else:
        raise RuntimeError('Unknown action')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('ZIPPY_BETA_DEPLOY_FAILED', type(exc).__name__, str(exc))
        sys.exit(1)
