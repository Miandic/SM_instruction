#!/usr/bin/python3
"""Installed by root in /usr/local/lib/sm-instruction; never self-updates."""
import fcntl
import hashlib
import os
from pathlib import Path
import pwd
import shutil
import sqlite3
import subprocess
import tempfile
import time
import urllib.request

BASE = Path('/opt/sm-instruction')
STATE = Path('/var/lib/sm-instruction-deploy')
REPO = BASE / 'build/github'
TOOLS = Path('/usr/local/lib/sm-instruction')
CARGO = '/var/lib/sm-build/.cargo/bin/cargo'
MIGRATIONS = ('src/db.rs', 'src/schema.sql')


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def build(*args, **kwargs):
    return run('runuser', '-u', 'sm-build', '--', *args, **kwargs)


def git(*args):
    return build('git', '-C', str(REPO), *args, stdout=subprocess.PIPE,
                 text=True).stdout.strip()


def migration_hash(root):
    return hashlib.sha256(b''.join((root / p).read_bytes() for p in MIGRATIONS)).hexdigest()


def smoke(release):
    account = pwd.getpwnam('sm-build')
    with tempfile.TemporaryDirectory(prefix='sm-smoke-', dir=BASE / 'build') as name:
        temp = Path(name)
        os.chown(temp, account.pw_uid, account.pw_gid)
        with sqlite3.connect('file:/var/lib/sm-instruction/data.db?mode=ro', uri=True) as src:
            with sqlite3.connect(temp / 'data.db') as dest:
                src.backup(dest)
        os.chown(temp / 'data.db', account.pw_uid, account.pw_gid)
        env = dict(os.environ, DATABASE_PATH=str(temp / 'data.db'),
                   BIND_ADDR='127.0.0.1:18081', ADMIN_LOGIN='admin',
                   ADMIN_PASSWORD='smoke-only-password-389274923', ALLOW_ADMIN_ADMIN='0')
        # This isolated process never receives the production configuration/secrets.
        with (temp / 'output.log').open('w') as log:
            proc = subprocess.Popen(['runuser', '-u', 'sm-build', '--',
                                     str(release / 'sm-instruction')],
                                    cwd=temp, env=env, stdout=log, stderr=log)
            try:
                for _ in range(30):
                    if proc.poll() is not None:
                        raise RuntimeError('Smoke process exited; production unchanged')
                    try:
                        for route in ('health', 'groups', 'characters'):
                            with urllib.request.urlopen('http://127.0.0.1:18081/api/' + route, timeout=2) as response:
                                assert response.status == 200
                        break
                    except OSError:
                        time.sleep(1)
                else:
                    raise RuntimeError('Smoke health timeout; production unchanged')
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
        with sqlite3.connect(temp / 'data.db') as db:
            assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
            assert not db.execute('PRAGMA foreign_key_check').fetchall()


def main():
    STATE.mkdir(exist_ok=True)
    with (STATE / 'lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not REPO.exists():
            build('git', 'clone', '--single-branch', '--branch', 'main',
                  'https://github.com/Miandic/SM_instruction.git', str(REPO))
        git('fetch', '--prune', 'origin', 'main')
        commit = git('rev-parse', 'origin/main')
        if (STATE / 'deployed').exists() and (STATE / 'deployed').read_text().strip() == commit:
            print('Already deployed: ' + commit, flush=True)
            return
        git('checkout', '--detach', '--force', commit)
        if migration_hash(REPO) != (STATE / 'approved-migrations').read_text().strip():
            raise RuntimeError('Database initialization/migrations changed; manual review required')
        print('Deploying main commit ' + commit, flush=True)
        env = dict(os.environ, CARGO_TARGET_DIR=str(BASE / 'build/target'))
        for args in [('fmt', '--all', '--', '--check'),
                     ('clippy', '--locked', '--all-targets', '--all-features', '-j', '2', '--', '-D', 'warnings'),
                     ('test', '--locked', '--all-targets', '-j', '2'),
                     ('build', '--release', '--locked', '-j', '2')]:
            build(CARGO, *args, cwd=REPO, env=env)
        for file in sorted((REPO / 'static').rglob('*.js')):
            with file.open('rb') as source:
                build('node', '--input-type=module', '--check', stdin=source)
        release = BASE / 'releases' / (time.strftime('github-%Y%m%dT%H%M%SZ-') + commit[:12])
        release.mkdir()
        shutil.copy2(BASE / 'build/target/release/sm-instruction', release / 'sm-instruction')
        shutil.copytree(REPO / 'static', release / 'static', ignore=shutil.ignore_patterns('uploads'))
        shutil.copytree(REPO / 'deploy', release / 'deploy')
        (release / 'GIT_COMMIT').write_text(commit + '\n')
        (release / 'SHA256SUMS').write_text(hashlib.sha256((release / 'sm-instruction').read_bytes()).hexdigest() + '  sm-instruction\n')
        smoke(release)
        run('bash', str(TOOLS / 'activate-release.sh'), str(release))
        (STATE / 'deployed').write_text(commit + '\n')
        print('Successfully deployed ' + commit, flush=True)


if __name__ == '__main__':
    main()
