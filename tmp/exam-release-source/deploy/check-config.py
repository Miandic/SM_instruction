"""Fail closed on unsafe production configuration; never print secrets."""
import os
import sys

errors = []
password = os.environ.get("ADMIN_PASSWORD", "")
# Explicit owner-requested exception; all other configuration checks still apply.
allow_admin_admin = (
    os.environ.get("ALLOW_ADMIN_ADMIN") == "1"
    and os.environ.get("ADMIN_LOGIN") == "admin"
    and password == "admin"
)
if not allow_admin_admin and (len(password) < 20 or password in {"admin", "change-me"}):
    errors.append("ADMIN_PASSWORD must contain at least 20 characters")
if os.environ.get("BIND_ADDR") != "127.0.0.1:18080":
    errors.append("BIND_ADDR must be 127.0.0.1:18080")
if os.environ.get("DATABASE_PATH") != "/var/lib/sm-instruction/data.db":
    errors.append("DATABASE_PATH must point to persistent production data")
if errors:
    print("Invalid production configuration: " + "; ".join(errors), file=sys.stderr)
    sys.exit(1)
