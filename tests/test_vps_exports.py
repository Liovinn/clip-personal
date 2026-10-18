import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import time
import zipfile

import pytest

import vps_exports


def test_missing_or_bad_private_configuration_never_leaks_its_value(monkeypatch, tmp_path):
    monkeypatch.setattr(vps_exports, "CONFIG_FILE", tmp_path / "missing")
    for raw in ("", "secret-not-base64", base64.b64encode(b'[]').decode()):
        monkeypatch.setenv("OPENSHORTS_VPS_CONFIG_B64", raw)
        assert not vps_exports.enabled()
        with pytest.raises(vps_exports.ExportError) as caught:
            vps_exports.configuration()
        assert "secret-not-base64" not in str(caught.value)


def test_private_file_fallback_and_environment_precedence(monkeypatch, tmp_path):
    config = {"host": "example.com", "port": 22, "user": "uploads", "base_url": "https://downloads.example.com",
              "private_key": "test fixture BEGIN OPENSSH PRIVATE KEY", "host_key": "ssh-ed25519 AAAA"}
    local = tmp_path / "private-config"
    local.write_text(base64.b64encode(json.dumps(config).encode()).decode())
    monkeypatch.setattr(vps_exports, "CONFIG_FILE", local)
    monkeypatch.delenv("OPENSHORTS_VPS_CONFIG_B64", raising=False)
    assert vps_exports.configuration()["host"] == "example.com"
    monkeypatch.setenv("OPENSHORTS_VPS_CONFIG_B64", "broken-private-value")
    assert not vps_exports.enabled()


@pytest.fixture
def receiver():
    spec = importlib.util.spec_from_file_location("vps_receiver", Path(__file__).parents[1] / "ops/vast/receive-vps.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def zip_bytes():
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_STORED) as bundle:
        bundle.writestr("clip.mp4", b"exact rendered clip bytes")
    return stream.getvalue()


@pytest.fixture
def receiver_config(tmp_path):
    return {"directory": str(tmp_path), "max_file_bytes": 1000000,
            "quota_bytes": 2000000, "reserve_bytes": 0,
            "base_url": "https://downloads.example.com", "signing_secret": "fixture-secret",
            "link_ttl_seconds": 3600}


@pytest.mark.skipif(os.name != "posix", reason="receiver requires Linux file locks")
class TestReceiver:
    def test_exact_zip_is_published_only_after_sha256_verification(self, receiver, receiver_config, zip_bytes):
        digest = hashlib.sha256(zip_bytes).hexdigest()
        result = receiver.receive(f"upload {digest} {len(zip_bytes)}", io.BytesIO(zip_bytes), receiver_config)
        assert result["status"] == "completed"
        assert (Path(receiver_config["directory"]) / f"{digest}.zip").read_bytes() == zip_bytes
        assert result["size_bytes"] == len(zip_bytes)
        assert result["expires_at"] > time.time()
        uri = f"/{digest}.zip"
        expected_signature = base64.urlsafe_b64encode(hashlib.md5(
            f"{result['expires_at']}{uri} fixture-secret".encode()).digest()).decode().rstrip("=")
        assert f"md5={expected_signature}&expires=" in result["url"]
        assert "fixture-secret" not in json.dumps(result)

    @pytest.mark.parametrize("body,declared", [(b"interrupted", 300), (b"too many bytes", 2)])
    def test_bad_or_incomplete_upload_never_becomes_downloadable(self, receiver, receiver_config, body, declared):
        with pytest.raises(ValueError):
            receiver.receive(f"upload {'a' * 64} {declared}", io.BytesIO(body), receiver_config)
        assert not list(Path(receiver_config["directory"]).glob("*.zip"))
        assert not list(Path(receiver_config["directory"]).glob(".upload-*"))

    @pytest.mark.parametrize("command", ["id", "bash", "upload ../../escape 10", "upload x 10; id", ""])
    def test_key_cannot_execute_commands_or_choose_paths(self, receiver, receiver_config, command):
        with pytest.raises(ValueError, match="Only verified ZIP"):
            receiver.receive(command, io.BytesIO(b""), receiver_config)

    def test_non_zip_and_quota_limit_fail_without_partial_files(self, receiver, receiver_config, zip_bytes):
        body = b"not a zip"
        with pytest.raises(ValueError, match="Only ZIP"):
            receiver.receive(f"upload {hashlib.sha256(body).hexdigest()} {len(body)}", io.BytesIO(body), receiver_config)
        receiver_config["quota_bytes"] = 1
        with pytest.raises(ValueError, match="storage is full"):
            receiver.receive(f"upload {hashlib.sha256(zip_bytes).hexdigest()} {len(zip_bytes)}", io.BytesIO(zip_bytes), receiver_config)
        assert not list(Path(receiver_config["directory"]).glob("*.zip"))


def test_transfer_only_reports_completion_after_receiver_confirmation(tmp_path, monkeypatch):
    archive = tmp_path / "archive.zip"
    archive.write_bytes(b"prepared zip fixture")
    monkeypatch.setattr(vps_exports, "configuration", lambda: {})
    with vps_exports._lock:
        vps_exports._states.clear()
    started, release = __import__("threading").Event(), __import__("threading").Event()
    def uploader(path, _config, progress):
        assert path == archive
        progress(10, 20)
        started.set()
        assert release.wait(5)
        return {"status": "completed", "url": "https://downloads.example.com/fixture",
                "size_bytes": 20, "expires_at": int(time.time()) + 3600}
    monkeypatch.setattr(vps_exports, "upload", uploader)
    vps_exports.start("job", archive)
    assert started.wait(5)
    assert vps_exports.state("job")["status"] == "uploading"
    assert not vps_exports.state("job").get("confirmed")
    release.set()
    for _ in range(100):
        if vps_exports.state("job")["status"] == "completed":
            break
        time.sleep(0.01)
    assert vps_exports.state("job")["confirmed"]
    assert vps_exports.start("job", archive)["status"] == "completed"


def test_transfer_failure_keeps_retry_available(tmp_path, monkeypatch):
    archive = tmp_path / "retry.zip"
    archive.write_bytes(b"prepared zip fixture")
    monkeypatch.setattr(vps_exports, "configuration", lambda: {})
    def fail(*_args):
        raise vps_exports.ExportError("Upload interrupted")
    monkeypatch.setattr(vps_exports, "upload", fail)
    vps_exports.start("retry-job", archive)
    for _ in range(100):
        if vps_exports.state("retry-job")["status"] == "failed":
            break
        time.sleep(0.01)
    assert vps_exports.state("retry-job")["confirmed"] is False
    assert archive.read_bytes() == b"prepared zip fixture"
