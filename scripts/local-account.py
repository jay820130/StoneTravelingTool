"""Create an explicitly requested local owner; password input is hidden."""
import getpass
import json
import subprocess

email = input("Local account email: ").strip()
password = getpass.getpass("Local password (at least 10 characters): ")
if len(password) < 10:
    raise SystemExit("Password must contain at least 10 characters.")
result = subprocess.run(["node", "scripts/local-account.mjs"], input=json.dumps({"email": email, "password": password}), text=True)
raise SystemExit(result.returncode)
