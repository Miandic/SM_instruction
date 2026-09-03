#!/bin/bash
set -euo pipefail
release=$(realpath -e "${1:?Usage: activate-release.sh /opt/sm-instruction/releases/RELEASE}")
[[ "$release" =~ ^/opt/sm-instruction/releases/[a-zA-Z0-9._-]+$ ]] || { echo 'Invalid release path' >&2; exit 1; }
test -x "$release/sm-instruction"
test -f "$release/static/index.html"
test -f "$release/deploy/check-config.py"
exec 9>/run/lock/sm-instruction-deploy.lock
flock -n 9
previous=$(readlink -f /opt/sm-instruction/current || true)
if test -f /var/lib/sm-instruction/data.db; then
    python3 /opt/sm-instruction/current/deploy/backup.py
fi
if test -e "$release/static/uploads" && ! test -L "$release/static/uploads"; then
    echo 'Release must not contain user uploads' >&2
    exit 1
fi
ln -sfn /var/lib/sm-instruction/uploads "$release/static/uploads"
chown -hR root:root "$release"
# Do not follow the uploads symlink when changing release permissions.
find "$release" -type d -exec chmod 755 {} +
find "$release" -type f -exec chmod 644 {} +
chmod 755 "$release/sm-instruction"
ln -sfn "$release" /opt/sm-instruction/current.next
mv -Tf /opt/sm-instruction/current.next /opt/sm-instruction/current
systemctl restart sm-instruction || true
for attempt in {1..20}; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:18080/api/health >/dev/null; then
        echo "Active release: $release"
        exit 0
    fi
    sleep 1
done
echo 'Health check failed; reverting code symlink. Inspect migrations before restoring data.' >&2
if test -n "$previous" && test -x "$previous/sm-instruction"; then
    ln -sfn "$previous" /opt/sm-instruction/current.next
    mv -Tf /opt/sm-instruction/current.next /opt/sm-instruction/current
    systemctl restart sm-instruction
fi
exit 1
