"""Install the pinned official Supabase CLI, verifying the publisher's SHA256 file."""
import hashlib
import io
import os
from pathlib import Path
import platform
import tarfile
import urllib.request

VERSION = "2.76.8"
root = Path(__file__).resolve().parent.parent
binary = root / ".local/bin/supabase"
system = {"Linux": "linux", "Darwin": "darwin"}.get(platform.system())
arch = {"x86_64": "amd64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine())
if not system or not arch:
    raise SystemExit("Install Supabase CLI using the official instructions for your OS.")
name = f"supabase_{system}_{arch}.tar.gz"
base = f"https://github.com/supabase/cli/releases/download/v{VERSION}/"
checksums = urllib.request.urlopen(base + f"supabase_{VERSION}_checksums.txt", timeout=30).read().decode()
expected = next(line.split()[0] for line in checksums.splitlines() if line.split()[-1] == name)
archive = urllib.request.urlopen(base + name, timeout=120).read()
if hashlib.sha256(archive).hexdigest() != expected:
    raise SystemExit("Supabase archive checksum mismatch; refusing installation.")
with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
    data = tar.extractfile("supabase").read()
binary.parent.mkdir(parents=True, exist_ok=True)
if not binary.exists() or hashlib.sha256(binary.read_bytes()).digest() != hashlib.sha256(data).digest():
    temporary = binary.with_suffix(".download")
    temporary.write_bytes(data)
    temporary.chmod(0o755)
    os.replace(temporary, binary)
print(f"Supabase CLI {VERSION} installed with publisher checksum verification.")
