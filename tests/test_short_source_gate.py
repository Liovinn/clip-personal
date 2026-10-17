"""HTTP tests for the too-short-source gate on /api/process.

A 24s YouTube Short cannot yield 15-60s clips: Gemini returns nothing and the
job dies with "no usable clips" after burning managed minutes (prod 20-ago).
The gate rejects such sources at submit, on all three ingest paths, with the
duration probes stubbed at their seams (_probe_youtube_quality for URLs,
_media_duration_seconds for local files). Probe failures (duration 0) fail
open — the job starts normally.
"""

import asyncio
import os

import httpx
import pytest

app_module = pytest.importorskip("app")


def _post_process(json_body=None, files=None, data=None):
    async def _do():
        transport = httpx.ASGITransport(app=app_module.app)
        async with httpx.AsyncClient(transport=transport,
                                     base_url="http://testserver") as client:
            return await client.post(
                "/api/process", json=json_body, files=files, data=data,
                headers={"X-Gemini-Key": "test-key"},
            )
    return asyncio.run(_do())


@pytest.fixture()
def dirs(tmp_path, monkeypatch):
    out_root = tmp_path / "output"
    up_root = tmp_path / "uploads"
    out_root.mkdir()
    up_root.mkdir()
    monkeypatch.setattr(app_module, "OUTPUT_DIR", str(out_root))
    monkeypatch.setattr(app_module, "UPLOAD_DIR", str(up_root))
    return out_root, up_root


def _stub_probe(monkeypatch, duration, max_height=1080):
    async def _probe(url):
        return {"max_height": max_height, "duration": duration}
    monkeypatch.setattr(app_module, "_probe_youtube_quality", _probe)


def test_short_url_source_is_rejected(dirs, monkeypatch):
    _stub_probe(monkeypatch, duration=24)
    resp = _post_process({"url": "https://www.youtube.com/watch?v=short", "acknowledged": True})
    assert resp.status_code == 400
    assert "24s" in resp.json()["detail"]


def test_short_url_rejected_even_with_force_low_quality(dirs, monkeypatch):
    """force_low_quality skips the quality confirm, not the short-source gate."""
    _stub_probe(monkeypatch, duration=24, max_height=360)
    resp = _post_process({"url": "https://www.youtube.com/watch?v=short",
                          "acknowledged": True, "force_low_quality": True})
    assert resp.status_code == 400


def test_unknown_duration_fails_open(dirs, monkeypatch):
    _stub_probe(monkeypatch, duration=0)
    resp = _post_process({"url": "https://www.youtube.com/watch?v=ok", "acknowledged": True})
    assert resp.status_code == 200
    assert "job_id" in resp.json()


def test_long_url_source_passes(dirs, monkeypatch):
    _stub_probe(monkeypatch, duration=600)
    resp = _post_process({"url": "https://www.youtube.com/watch?v=ok", "acknowledged": True})
    assert resp.status_code == 200


@pytest.mark.parametrize("source", ["url", "file"])
@pytest.mark.parametrize("acknowledgement", [None, False, True])
def test_processing_without_required_confirmation(dirs, monkeypatch, source, acknowledgement):
    """Both dashboard input paths work without recording a false confirmation."""
    monkeypatch.setattr(app_module, "jobs", {})
    monkeypatch.setattr(app_module, "job_queue", asyncio.PriorityQueue())
    _stub_probe(monkeypatch, duration=600)
    monkeypatch.setattr(app_module, "_media_duration_seconds", lambda path: 600.0)

    async def allow_url(url):
        return None

    monkeypatch.setattr(app_module, "_validate_source_url", allow_url)
    fields = {} if acknowledgement is None else {"acknowledged": acknowledgement}
    if source == "url":
        resp = _post_process({"url": "https://example.com/video.mp4", **fields})
    else:
        resp = _post_process(
            files={"file": ("video.mp4", b"fake-video", "video/mp4")},
            data={key: str(value).lower() for key, value in fields.items()},
        )

    assert resp.status_code == 200, resp.text
    job = app_module.jobs[resp.json()["job_id"]]
    assert job["attestation"]["acknowledged"] is (acknowledgement is True)
    assert app_module.job_queue.qsize() == 1


def test_gate_disabled_lets_short_sources_through(dirs, monkeypatch):
    _stub_probe(monkeypatch, duration=24)
    monkeypatch.setattr(app_module, "MIN_SOURCE_SECONDS", 0)
    resp = _post_process({"url": "https://www.youtube.com/watch?v=short", "acknowledged": True})
    assert resp.status_code == 200


def test_short_upload_is_rejected_and_cleaned_up(dirs, monkeypatch):
    out_root, up_root = dirs
    monkeypatch.setattr(app_module, "_media_duration_seconds", lambda path: 24.0)
    resp = _post_process(files={"file": ("short.mp4", b"fake-bytes", "video/mp4")},
                         data={"acknowledged": "true"})
    assert resp.status_code == 400
    assert "24s" in resp.json()["detail"]
    # The rejected upload and its job dir must not linger on disk.
    assert os.listdir(up_root) == []
    assert os.listdir(out_root) == []


def test_short_thumbnail_session_is_rejected(dirs, monkeypatch):
    out_root, up_root = dirs
    video = up_root / "thumb_sess1_source.mp4"
    video.write_bytes(b"fake-video-bytes")
    monkeypatch.setitem(app_module.thumbnail_sessions, "sess1", {
        "user_id": None, "video_path": str(video),
        "transcript_ready": False, "transcript": None,
    })
    monkeypatch.setattr(app_module, "_media_duration_seconds", lambda path: 24.0)
    resp = _post_process({"thumbnail_session_id": "sess1", "acknowledged": True})
    assert resp.status_code == 400
    # The session's own video stays; only the aborted job dir is cleaned.
    assert os.path.exists(video)
    assert os.listdir(out_root) == []
