import concurrent.futures
import os
import zipfile

import pytest

import clip_exports


def test_zip_keeps_exact_clip_bytes_and_reuses_the_finished_archive(tmp_path):
    clip = tmp_path / "captioned_clip.mp4"
    clip.write_bytes(b"already rendered video bytes")
    archive_id, archive = clip_exports.prepare_archive(tmp_path, [(2, clip)])
    original_mtime = archive.stat().st_mtime_ns
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.namelist() == ["clip_03_captioned_clip.mp4"]
        assert bundle.read(bundle.namelist()[0]) == clip.read_bytes()
        assert bundle.infolist()[0].compress_type == zipfile.ZIP_STORED
    assert clip_exports.prepare_archive(tmp_path, [(2, clip)]) == (archive_id, archive)
    assert archive.stat().st_mtime_ns == original_mtime


def test_edits_make_a_new_zip_without_breaking_a_previous_download(tmp_path):
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"old")
    _, old_archive = clip_exports.prepare_archive(tmp_path, [(0, clip)])
    clip.write_bytes(b"new version")
    _, new_archive = clip_exports.prepare_archive(tmp_path, [(0, clip)])
    assert old_archive != new_archive
    with zipfile.ZipFile(old_archive) as bundle:
        assert bundle.read("clip_01_clip.mp4") == b"old"
    with zipfile.ZipFile(new_archive) as bundle:
        assert bundle.read("clip_01_clip.mp4") == b"new version"


def test_concurrent_requests_share_one_complete_zip(tmp_path):
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(os.urandom(100_000))
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(lambda _: clip_exports.prepare_archive(tmp_path, [(0, clip)]), range(10)))
    assert len(set(results)) == 1
    assert len(list((tmp_path / ".exports").glob("*.zip"))) == 1
    assert not list((tmp_path / ".exports").glob("*.partial"))
    with zipfile.ZipFile(results[0][1]) as bundle:
        assert bundle.testzip() is None


def test_failed_build_leaves_no_partial_download_and_can_retry(tmp_path, monkeypatch):
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"video")
    original = zipfile.ZipFile.write
    with monkeypatch.context() as patch:
        def fail(*args, **kwargs):
            raise OSError("disk full")
        patch.setattr(zipfile.ZipFile, "write", fail)
        with pytest.raises(OSError):
            clip_exports.prepare_archive(tmp_path, [(0, clip)])
    assert not list((tmp_path / ".exports").iterdir())
    assert zipfile.ZipFile.write is original
    _, archive = clip_exports.prepare_archive(tmp_path, [(0, clip)])
    assert archive.exists()


def test_source_files_outside_the_job_cannot_be_exported(tmp_path):
    job = tmp_path / "job"
    job.mkdir()
    secret = tmp_path / "secret.mp4"
    secret.write_bytes(b"private")
    with pytest.raises(ValueError):
        clip_exports.prepare_archive(job, [(0, secret)])
    with pytest.raises(ValueError):
        clip_exports.job_directory(tmp_path, "../outside")


def test_drive_folder_contains_only_the_zip(tmp_path):
    (tmp_path / ".owner").write_text("private owner")
    (tmp_path / "source.mp4").write_bytes(b"full source video")
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"finished clip")
    archive_id, archive = clip_exports.prepare_archive(tmp_path, [(0, clip)])
    folder = clip_exports.drive_source(tmp_path, archive_id, "clips.zip")
    assert [p.name for p in folder.iterdir()] == ["clips.zip"]
    assert (folder / "clips.zip").read_bytes() == archive.read_bytes()
