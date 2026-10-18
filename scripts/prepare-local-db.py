"""Flatten a digest-pinned, verified official image for Docker's space-heavy VFS driver.

This changes only the local image's layer representation, not its filesystem.
Crane verifies registry blob digests. Preserve image runtime configuration and
label the local derivative with its publisher source digest; never claim its
new Docker image ID is the upstream image digest.
"""
import hashlib
import io
import json
from pathlib import Path
import platform
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
TAG = "supabase/postgres:17.6.1.081"
DIGEST = "sha256:b7c9e3315b351a747af1763d3e78e990b2ae97fbdcf5d538d08a3dd6723a88a4"
SOURCE = "registry-1.docker.io/supabase/postgres@" + DIGEST
def output(args):
    return subprocess.check_output(args, cwd=ROOT, text=True, stderr=subprocess.PIPE).strip()

if output(["docker", "info", "--format", "{{.Driver}}"] ) != "vfs":
    print("Docker supports layered storage; no image preparation needed.")
    raise SystemExit(0)
if subprocess.run(["docker", "image", "inspect", TAG], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
    print("Local PostgreSQL image already available; reusing it.")
    raise SystemExit(0)
if platform.system() != "Linux" or platform.machine() != "x86_64":
    raise SystemExit("VFS preparation is pinned for Linux amd64. Use Docker overlay storage or configure Supabase remotely on other platforms.")
crane = ROOT / ".local/bin/crane"
if not crane.exists():
    base = "https://github.com/google/go-containerregistry/releases/download/v0.20.3/"
    name = "go-containerregistry_Linux_x86_64.tar.gz"
    checks = urllib.request.urlopen(base + "checksums.txt", timeout=30).read().decode()
    data = urllib.request.urlopen(base + name, timeout=60).read()
    expected = next(line.split()[0] for line in checks.splitlines() if line.split()[-1] == name)
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit("Crane checksum mismatch; refusing installation.")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        binary = archive.extractfile("crane").read()
    crane.parent.mkdir(parents=True, exist_ok=True)
    crane.write_bytes(binary)
    crane.chmod(0o755)

print("Preparing official PostgreSQL filesystem for VFS using a pinned registry digest…", flush=True)
config = json.loads(output([str(crane), "config", "--platform", "linux/amd64", SOURCE]))["config"]
rootfs = ROOT / ".local/postgres-flat.tar"
receipt = rootfs.with_suffix(".receipt.json")
reuse = False
if rootfs.exists() and receipt.exists():
    saved = json.loads(receipt.read_text())
    with rootfs.open("rb") as handle:
        reuse = saved.get("source") == SOURCE and saved.get("sha256") == hashlib.file_digest(handle, "sha256").hexdigest()
if not reuse:
    subprocess.run([str(crane), "export", "--platform", "linux/amd64", SOURCE, str(rootfs)], cwd=ROOT, check=True)
    with rootfs.open("rb") as handle:
        receipt.write_text(json.dumps({"source":SOURCE,"sha256":hashlib.file_digest(handle,"sha256").hexdigest()}))
args = ["docker", "import"]
for field in ["Cmd", "Entrypoint", "WorkingDir", "User"]:
    value = config.get(field)
    if value:
        instruction = {"Cmd":"CMD", "Entrypoint":"ENTRYPOINT", "WorkingDir":"WORKDIR", "User":"USER"}[field]
        args += ["--change", instruction + " " + (json.dumps(value) if isinstance(value, list) else value)]
for entry in config.get("Env", []):
    key, value = entry.split("=", 1)
    args += ["--change", f"ENV {key}={json.dumps(value)}"]
for port in config.get("ExposedPorts", {}):
    args += ["--change", "EXPOSE " + port]
for volume in config.get("Volumes", {}):
    args += ["--change", "VOLUME " + json.dumps([volume])]
for key, value in {**config.get("Labels", {}), "stone.source-digest": DIGEST, "stone.flattened-for-vfs":"true"}.items():
    args += ["--change", f"LABEL {key}={json.dumps(value)}"]
args += [str(rootfs), TAG]
subprocess.run(args, cwd=ROOT, stdout=subprocess.DEVNULL, check=True)
rootfs.unlink()
receipt.unlink(missing_ok=True)
print("Local flattened image imported; publisher filesystem and runtime settings preserved.")
