#!/usr/bin/env python3
"""Forced SSH command: accept one verified ZIP and mint an expiring link.

Install as a root-owned script. The upload account must not own its home,
authorized_keys, this script or its configuration. Its key uses restrict.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import shutil
import sys
import tempfile
import time
import zipfile


def receive(command, stream, config):
    import fcntl
    args = shlex.split(command)
    if (len(args) != 3 or args[0] != "upload"
            or not re.fullmatch(r"[a-f0-9]{64}", args[1])
            or not re.fullmatch(r"[1-9][0-9]{0,11}", args[2])):
        raise ValueError("Only verified ZIP uploads are allowed.")
    digest, expected_size = args[1], int(args[2])
    if expected_size > config["max_file_bytes"]:
        raise ValueError("ZIP exceeds the VPS upload limit.")
    folder = Path(config["directory"])
    destination = folder / f"{digest}.zip"
    temporary = None
    with (folder / ".upload.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if destination.is_symlink():
            raise ValueError("Invalid ZIP destination.")
        used = sum(p.stat().st_size for p in folder.glob("*.zip"))
        additional = 0 if destination.exists() else expected_size
        if used + additional > config["quota_bytes"]:
            raise ValueError("VPS export storage is full. Remove old exports before retrying.")
        if shutil.disk_usage(folder).free - expected_size < config["reserve_bytes"]:
            raise ValueError("Not enough free VPS disk space for this ZIP.")
        try:
            hasher = hashlib.sha256()
            received = 0
            with tempfile.NamedTemporaryFile(prefix=".upload-", dir=folder, delete=False) as out:
                temporary = Path(out.name)
                while chunk := stream.read(min(1024 * 1024, expected_size - received + 1)):
                    received += len(chunk)
                    if received > expected_size:
                        raise ValueError("Upload exceeded its declared size.")
                    hasher.update(chunk)
                    out.write(chunk)
                if received != expected_size or hasher.hexdigest() != digest:
                    raise ValueError("Upload was interrupted or its checksum did not match. Retry the upload.")
                out.flush()
                os.fsync(out.fileno())
            if not zipfile.is_zipfile(temporary):
                raise ValueError("Only ZIP archives can be stored here.")
            os.chmod(temporary, 0o640)
            os.replace(temporary, destination)
            temporary = None
            # Commit the rename before reporting a durable copy.
            directory_fd = os.open(folder, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    expires = int(time.time()) + config["link_ttl_seconds"]
    uri = f"/{digest}.zip"
    # Matches nginx secure_link_md5 "$secure_link_expires$uri SECRET".
    signature = base64.urlsafe_b64encode(hashlib.md5(
        f"{expires}{uri} {config['signing_secret']}".encode()).digest()).decode().rstrip("=")
    return {"status": "completed", "sha256": digest, "size_bytes": received,
            "url": f"{config['base_url']}{uri}?md5={signature}&expires={expires}",
            "expires_at": expires}


def main():
    def expired(_signal, _frame):
        raise ValueError("VPS upload timed out. Retry the upload.")
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(1800)
    try:
        with open("/etc/openshorts-delivery.json", encoding="utf-8") as source:
            config = json.load(source)
        result = receive(os.environ.get("SSH_ORIGINAL_COMMAND", ""), sys.stdin.buffer, config)
    except ValueError as error:
        print(json.dumps({"status": "failed", "error": str(error)}))
        return 1
    except OSError:
        print(json.dumps({"status": "failed", "error": "VPS could not store the ZIP. Check its disk and delivery configuration."}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
