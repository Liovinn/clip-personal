"""Optional finished-ZIP delivery over restricted SSH. No pipeline imports."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlsplit


class ExportError(Exception):
    pass


CONFIG_FILE = Path(__file__).parent / ".cache/vast/vps-config.b64"


def configuration():
    raw = os.environ.get("OPENSHORTS_VPS_CONFIG_B64", "")
    if not raw:
        try:
            raw = CONFIG_FILE.read_text().strip()
        except (OSError, UnicodeError):
            pass
    if not raw:
        raise ExportError("Configure the private VPS delivery setting first.")
    try:
        config = json.loads(base64.b64decode(raw, validate=True))
        base = urlsplit(config["base_url"])
        if not (re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}", config["host"])
                and re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", config["user"])
                and type(config["port"]) is int and 1 <= config["port"] <= 65535
                and base.scheme == "https" and base.hostname and not base.username and not base.password
                and base.path in ("", "/") and not base.query and not base.fragment
                and "BEGIN OPENSSH PRIVATE KEY" in config["private_key"]
                and re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+", config["host_key"])):
            raise ValueError("Invalid private configuration")
        config["base_url"] = config["base_url"].rstrip("/")
        return config
    except (ValueError, KeyError, TypeError, AttributeError):
        raise ExportError("The private VPS delivery setting is invalid.") from None


def enabled():
    try:
        configuration()
        return True
    except ExportError:
        return False


def upload(archive, config, progress=lambda _sent, _total: None):
    """Upload exact bytes; completion requires receiver SHA-256 confirmation."""
    archive = Path(archive)
    size = archive.stat().st_size
    hasher = hashlib.sha256()
    with archive.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            hasher.update(chunk)
    digest = hasher.hexdigest()
    with tempfile.TemporaryDirectory(prefix="openshorts-vps-") as temp:
        folder = Path(temp)
        os.chmod(folder, 0o700)
        key, hosts = folder / "key", folder / "known_hosts"
        key.write_text(config["private_key"].rstrip() + "\n", encoding="utf-8")
        os.chmod(key, 0o600)
        if os.name == "nt":
            # chmod alone does not remove inherited Windows ACL entries.
            try:
                for options in (["/reset"], ["/inheritance:r", "/grant:r", f"{getpass.getuser()}:(R)",
                                             "/remove", "*S-1-3-4"]):
                    subprocess.run(["icacls", str(key), *options], check=True,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except (OSError, subprocess.CalledProcessError):
                raise ExportError("Could not protect the temporary SSH key on this computer.") from None
        # A fixed alias binds this connection to the pinned host public key.
        hosts.write_text(f"openshorts-vps {config['host_key']}\n", encoding="utf-8")
        command = ["ssh", "-T", "-F", os.devnull, "-o", "BatchMode=yes",
                   "-o", "StrictHostKeyChecking=yes", "-o", "IdentitiesOnly=yes",
                   "-o", "HostKeyAlias=openshorts-vps", "-o", f"UserKnownHostsFile={hosts}",
                   "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15",
                   "-o", "ServerAliveCountMax=3", "-i", str(key), "-p", str(config["port"]),
                   f"{config['user']}@{config['host']}", f"upload {digest} {size}"]
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
            try:
                process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=output, stderr=errors)
            except OSError:
                raise ExportError("SSH is unavailable on this instance.") from None
            watchdog = threading.Timer(1800, process.kill)
            watchdog.daemon = True
            watchdog.start()
            try:
                sent = 0
                with archive.open("rb") as source:
                    while chunk := source.read(1024 * 1024):
                        process.stdin.write(chunk)
                        sent += len(chunk)
                        progress(sent, size)
                process.stdin.close()
                process.wait(timeout=45)
            except (OSError, subprocess.TimeoutExpired):
                process.kill()
                process.wait()
            finally:
                watchdog.cancel()
                try:
                    process.stdin.close()
                except OSError:
                    pass
            output.seek(0)
            try:
                result = json.loads(output.read(16384))
            except (ValueError, UnicodeError):
                raise ExportError("VPS connection failed. Check the upload key and pinned server key, then retry.") from None
            if not isinstance(result, dict):
                raise ExportError("The VPS returned an invalid upload confirmation.")
            if result.get("status") == "failed":
                # Receiver errors are deliberately generic and contain no keys.
                raise ExportError(str(result.get("error", "VPS rejected the upload."))[:300])
            if (process.returncode != 0 or result.get("status") != "completed"
                    or result.get("sha256") != digest or result.get("size_bytes") != size
                    or not str(result.get("url", "")).startswith(f"{config['base_url']}/{digest}.zip?")):
                raise ExportError("The VPS did not confirm a verified copy. Keep the Vast instance running and retry.")
            return result


_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="clip-export")
_lock = threading.Lock()
_states = {}


def state(job_id):
    with _lock:
        return dict(_states.get(job_id, {"status": "idle"}))


def start(job_id, archive):
    config = configuration()
    archive = Path(archive)
    archive_id = archive.stem
    with _lock:
        previous = _states.get(job_id)
        if previous and (previous["status"] in ("queued", "uploading") or (
                previous.get("archive_id") == archive_id and previous["status"] == "completed"
                and previous.get("expires_at", 0) > time.time() + 60)):
            return dict(previous)
        # Bound memory; no delivery files or GPU jobs are deleted here.
        for old in list(_states):
            if len(_states) < 100:
                break
            if _states[old]["status"] not in ("queued", "uploading"):
                _states.pop(old)
        if sum(s["status"] in ("queued", "uploading") for s in _states.values()) >= 3:
            raise ExportError("Three VPS transfers are already queued. Wait for one to finish.")
        initial = {"status": "queued", "archive_id": archive_id,
                   "size_bytes": archive.stat().st_size, "sent_bytes": 0}
        _states[job_id] = initial

    def update(**values):
        with _lock:
            _states[job_id].update(values)

    def run():
        update(status="uploading")
        try:
            result = upload(archive, config, lambda sent, _total: update(sent_bytes=sent))
            update(**result, confirmed=True)
        except ExportError as error:
            update(status="failed", error=str(error), confirmed=False)
        except Exception:
            update(status="failed", error="VPS upload failed. Keep the Vast instance running and retry.", confirmed=False)
    _pool.submit(run)
    return dict(initial)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Upload an already prepared clip ZIP to the configured VPS.")
    parser.add_argument("zip", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(upload(args.zip, configuration())))
    except ExportError as error:
        parser.exit(1, str(error) + "\n")
