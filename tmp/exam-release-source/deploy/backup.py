#!/usr/bin/python3
"""Online SQLite backup, uploads and release metadata, with bounded retention."""
import datetime
import fcntl
import os
from pathlib import Path
import shutil
import sqlite3
import tarfile
import tempfile

os.umask(0o077)
root = Path("/var/backups/sm-instruction")
root.mkdir(parents=True, exist_ok=True)
lock = (root / ".lock").open("w")
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
archive = root / (stamp + ".tar.gz")
with tempfile.TemporaryDirectory(dir=root) as temp:
    temp = Path(temp)
    with sqlite3.connect("file:/var/lib/sm-instruction/data.db?mode=ro", uri=True) as source:
        with sqlite3.connect(temp / "data.db") as target:
            source.backup(target)
            if target.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise RuntimeError("Backup integrity check failed")
    (temp / "release.txt").write_text(str(Path("/opt/sm-instruction/current").resolve()) + "\n")
    shutil.copyfile("/etc/sm-instruction/app.env", temp / "app.env")
    partial = archive.with_suffix(".partial")
    with tarfile.open(partial, "w:gz") as bundle:
        for name in ["data.db", "release.txt", "app.env"]:
            bundle.add(temp / name, arcname=name)
        bundle.add("/var/lib/sm-instruction/uploads", arcname="uploads")
    partial.rename(archive)
# Keep the latest 14 complete snapshots. Upload filenames are immutable UUIDs.
for old in sorted(root.glob("*.tar.gz"))[:-14]:
    old.unlink()
print(archive)
