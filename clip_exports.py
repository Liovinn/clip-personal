"""Package finished clips for delivery; never render or modify their contents."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import threading
import uuid
import zipfile


ARCHIVE_ID = re.compile(r"^[0-9a-f]{64}$")
_locks = {}
_locks_guard = threading.Lock()


def job_directory(output_root, job_id):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", job_id):
        raise ValueError("Invalid job ID")
    root = Path(output_root).resolve()
    folder = (root / job_id).resolve()
    if folder.parent != root:
        raise ValueError("Invalid job directory")
    return folder


@contextmanager
def _locked(key):
    with _locks_guard:
        entry = _locks.setdefault(str(key), [threading.Lock(), 0])
        entry[1] += 1
    try:
        with entry[0]:
            yield
    finally:
        with _locks_guard:
            entry[1] -= 1
            if not entry[1]:
                _locks.pop(str(key), None)


def _snapshot(files):
    return [(index, path.name, path.stat().st_size, path.stat().st_mtime_ns)
            for index, path in files]


def prepare_archive(folder, files):
    """Atomically cache one ZIP for this exact set of clip file versions."""
    folder = Path(folder).resolve()
    files = [(index, Path(path).resolve()) for index, path in files]
    if not files:
        raise ValueError("No clip files found for this job")
    if any(path.parent != folder or not path.is_file() for _, path in files):
        raise ValueError("A clip is missing or outside the job directory")
    snapshot = _snapshot(files)
    archive_id = hashlib.sha256(json.dumps(snapshot).encode()).hexdigest()
    cache = folder / ".exports"
    if cache.is_symlink():
        raise ValueError("Invalid export directory")
    cache.mkdir(exist_ok=True)
    archive = cache / f"{archive_id}.zip"
    with _locked(archive):
        if not archive.is_file():
            temporary = cache / f"{uuid.uuid4().hex}.partial"
            try:
                # MP4 is compressed already: preserve bytes, skip recompression.
                with zipfile.ZipFile(temporary, "w", zipfile.ZIP_STORED) as bundle:
                    for index, path in files:
                        bundle.write(path, arcname=f"clip_{index + 1:02d}_{path.name}")
                if _snapshot(files) != snapshot:
                    raise ValueError("Clips changed during export. Please try again.")
                os.replace(temporary, archive)
            finally:
                temporary.unlink(missing_ok=True)
    return archive_id, archive


def archive_path(folder, archive_id):
    if not ARCHIVE_ID.fullmatch(archive_id):
        raise ValueError("Invalid archive ID")
    folder = Path(folder).resolve()
    archive = folder / ".exports" / f"{archive_id}.zip"
    if archive.is_symlink() or archive.parent.is_symlink() or not archive.is_file():
        raise FileNotFoundError("ZIP is no longer available. Prepare the download again.")
    return archive


def drive_source(folder, archive_id, filename):
    """Expose only the ZIP in a dedicated folder for Vast Cloud Copy."""
    archive = archive_path(folder, archive_id)
    export_dir = archive.parent / "drive" / archive_id
    if export_dir.resolve() != export_dir or not re.fullmatch(r"[A-Za-z0-9_.-]+", filename):
        raise ValueError("Invalid cloud export path")
    export_dir.mkdir(parents=True, exist_ok=True)
    if any(path.name != filename or path.is_symlink() for path in export_dir.iterdir()):
        raise ValueError("Cloud export folder must contain only the ZIP")
    destination = export_dir / filename
    with _locked(destination):
        if not destination.exists():
            try:
                os.link(archive, destination)
            except OSError:
                shutil.copyfile(archive, destination)
    return export_dir
