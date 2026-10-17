import asyncio
import io
import json
import time
from types import SimpleNamespace
import zipfile

import httpx
import pytest

app_module = pytest.importorskip("app")
JOB = "export-test-job"


def request(method, path):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_module.app),
                                     base_url="http://testserver") as client:
            return await client.request(method, path)
    return asyncio.run(run())


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "OUTPUT_DIR", str(tmp_path))
    folder = tmp_path / JOB
    folder.mkdir()
    (folder / "video_metadata.json").write_text(json.dumps({"shorts": [{"start": 0, "end": 20}]}))
    (folder / "video_clip_1.mp4").write_bytes(b"clean clip")
    (folder / "subtitled_video_clip_1.mp4").write_bytes(b"current captioned clip")
    app_module.jobs[JOB] = {"status": "completed", "user_id": "owner",
                            "result": {"clips": [{"video_url": f"/videos/{JOB}/subtitled_video_clip_1.mp4"}]}}
    yield folder
    app_module.jobs.pop(JOB, None)


def test_prepare_then_native_download_and_resume(project):
    prepared = request("POST", f"/api/jobs/{JOB}/download-all")
    assert prepared.status_code == 200
    info = prepared.json()
    response = request("GET", info["url"])
    assert response.status_code == 200
    assert int(response.headers["content-length"]) == info["size_bytes"]
    assert "attachment" in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as bundle:
        assert bundle.read(bundle.namelist()[0]) == b"current captioned clip"

    async def resume():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_module.app),
                                     base_url="http://testserver") as client:
            return await client.get(info["url"], headers={"Range": "bytes=3-12",
                                                          "If-Range": response.headers["etag"]})
    partial = asyncio.run(resume())
    assert partial.status_code == 206
    assert partial.content == response.content[3:13]
    assert partial.headers["content-range"] == f"bytes 3-12/{len(response.content)}"
    assert request("POST", f"/api/jobs/{JOB}/download-all").json()["archive_id"] == info["archive_id"]


def test_legacy_download_remains_available(project):
    assert request("GET", f"/api/jobs/{JOB}/download-all").status_code == 200


def test_unknown_job_is_a_readable_error():
    response = request("POST", "/api/jobs/no-such-export-job/download-all")
    assert response.status_code == 404


def test_signed_export_is_scoped_and_owner_guard_survives(project, monkeypatch):
    monkeypatch.setattr(app_module, "BILLING_ENABLED", True)
    monkeypatch.setattr(app_module, "_cloud_config", SimpleNamespace(settings=SimpleNamespace(jwt_secret="test-only-secret")), raising=False)
    user = SimpleNamespace(id="owner")
    async def resolve(_request):
        return user
    monkeypatch.setattr(app_module, "_user_from_request", resolve)
    info = request("POST", f"/api/jobs/{JOB}/download-all").json()
    unsigned = info["url"].split("?")[0]
    user.id = "someone-else"
    assert request("GET", unsigned).status_code == 404
    assert request("POST", f"/api/jobs/{JOB}/download-all").status_code == 404
    assert request("GET", info["url"]).status_code == 200
    expired = int(time.time()) - 1
    signature = app_module._source_signature(f"export:{JOB}:{info['archive_id']}", expired)
    assert request("GET", f"{unsigned}?exp={expired}&sig={signature}").status_code == 404
    # A source-video signature must not authorize downloading a ZIP.
    expires = int(time.time()) + 60
    assert request("GET", f"{unsigned}?exp={expires}&sig={app_module._source_signature(JOB, expires)}").status_code == 404


def test_drive_is_optional_and_never_exposes_keys(monkeypatch):
    monkeypatch.delenv("OPENSHORTS_DRIVE_CONNECTION_ID", raising=False)
    assert request("GET", "/api/exports/drive-config").json() == {"enabled": False}
    assert request("POST", f"/api/jobs/{JOB}/export-drive").status_code == 503


def test_managed_cloud_cannot_use_instance_drive_credentials(monkeypatch):
    monkeypatch.setattr(app_module, "BILLING_ENABLED", True)
    monkeypatch.setenv("OPENSHORTS_DRIVE_CONNECTION_ID", "123")
    monkeypatch.setenv("CONTAINER_ID", "456")
    monkeypatch.setenv("CONTAINER_API_KEY", "private-instance-key")
    assert request("GET", "/api/exports/drive-config").json() == {"enabled": False}
    response = request("POST", f"/api/jobs/{JOB}/export-drive")
    assert response.status_code == 404
    assert "private-instance-key" not in response.text


@pytest.mark.parametrize("provider_status,provider_body,expected", [
    (200, {"success": True}, 200),
    (200, {"success": False, "msg": "rejected"}, 502),
    (403, {"msg": "invalid permission"}, 502),
])
def test_drive_copies_only_zip_and_never_claims_upload_complete(
        project, monkeypatch, provider_status, provider_body, expected):
    monkeypatch.setenv("OPENSHORTS_DRIVE_CONNECTION_ID", "123")
    monkeypatch.setenv("CONTAINER_ID", "C.456")
    monkeypatch.setenv("CONTAINER_API_KEY", "test-instance-key")
    sent = []
    async def post(client, url, **kwargs):
        sent.append((url, kwargs))
        return httpx.Response(provider_status, json=provider_body)
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    response = request("POST", f"/api/jobs/{JOB}/export-drive")
    assert response.status_code == expected
    assert len(sent) == 1
    url, options = sent[0]
    assert url == "https://console.vast.ai/api/v0/commands/rclone/"
    assert options["headers"]["Authorization"] == "Bearer test-instance-key"
    payload = options["json"]
    from pathlib import Path
    assert [file.name for file in Path(payload["src"]).iterdir()] == ["openshorts_clips_export-t.zip"]
    assert payload["selected"] == "123"
    assert payload["instance_id"] == "456"
    assert payload["transfer"] == "Instance To Cloud"
    assert "test-instance-key" not in response.text
    if expected == 200:
        assert response.json()["status"] == "submitted"
        assert response.json()["confirmed"] is False
