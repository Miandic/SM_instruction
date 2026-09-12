#!/bin/bash
# Run as root with the three github-sync files staged in /tmp.
set -euo pipefail
install -d -m 755 /usr/local/lib/sm-instruction /var/lib/sm-instruction-deploy
install -m 755 /tmp/github-sync.py /usr/local/lib/sm-instruction/github-sync.py
install -m 644 /tmp/sm-instruction-github-sync.{service,timer} /etc/systemd/system/
cp /opt/sm-instruction/current/deploy/activate-release.sh /usr/local/lib/sm-instruction/
cp /opt/sm-instruction/current/deploy/backup.py /usr/local/lib/sm-instruction/
sed -i 's@/opt/sm-instruction/current/deploy/backup.py@/usr/local/lib/sm-instruction/backup.py@' /usr/local/lib/sm-instruction/activate-release.sh
python3 - <<'PY'
import hashlib
from pathlib import Path
baseline = Path('/var/lib/sm-instruction-deploy/approved-migrations')
if not baseline.exists():
    root = Path('/opt/sm-instruction/build/source')
    baseline.write_text(hashlib.sha256(b''.join((root / p).read_bytes() for p in ('src/db.rs', 'src/schema.sql'))).hexdigest() + '\n')
PY
python3 -m py_compile /usr/local/lib/sm-instruction/github-sync.py
bash -n /usr/local/lib/sm-instruction/activate-release.sh
systemd-analyze verify /etc/systemd/system/sm-instruction-github-sync.service /etc/systemd/system/sm-instruction-github-sync.timer
systemctl daemon-reload
systemctl start --no-block sm-instruction-github-sync.service
