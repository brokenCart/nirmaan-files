"""Where uploaded files live.

Only this module knows about Google Drive. Callers ask for a folder, put bytes
in it and read them back, using the opaque id they were given. See
``docs/log-images.md`` for how it is set up and why it works this way.
"""

import json
import logging
import re
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Protocol

import google.auth
import google.auth.exceptions
import requests
from django.conf import settings
from django.db import transaction
from django.utils.functional import cached_property
from django.utils.module_loading import import_string
from google.auth.transport.requests import AuthorizedSession

from .models import DriveFolder

logger = logging.getLogger(__name__)


class StorageError(Exception):
    """A storage call failed. The message is safe to show to a user."""


@dataclass(frozen=True)
class Thumbnail:
    content: bytes
    content_type: str


@dataclass(frozen=True)
class ResumableProgress:
    received: int
    file_id: str | None = None


@dataclass(frozen=True)
class RangedStream:
    chunks: Iterator[bytes]
    status: int
    content_length: int | None = None
    content_range: str | None = None


class Storage(Protocol):
    root_folder_id: str

    @property
    def available(self) -> bool:
        """Whether this backend has what it needs to accept a file."""

    def create_folder(self, name: str, parent_id: str) -> str: ...

    def upload(self, name: str, content: bytes, content_type: str, parent_id: str) -> str: ...

    def open(self, file_id: str) -> Iterator[bytes]: ...

    def thumbnail(self, file_id: str, size: int) -> Thumbnail | None:
        """A smaller copy of the image, or None to fall back to the full file."""

    def start_resumable(self, name: str, content_type: str, size: int, parent_id: str) -> str:
        """Open an upload session. The returned handle is private to the backend."""

    def send_chunk(self, session: str, content: bytes, offset: int, total: int) -> str | None:
        """Add one chunk. Returns the file id once the last chunk has landed."""

    def query_resumable(self, session: str, total: int) -> ResumableProgress: ...

    def open_range(self, file_id: str, byte_range: str | None) -> RangedStream: ...


class GoogleDriveStorage:
    """Google Drive, authenticated by ``DRIVE_CREDENTIALS_JSON``.

    The JSON may be a service account key or an authorized-user token. Every
    call is the same for both, so the choice is configuration. ``supportsAllDrives``
    is required for Shared Drives and harmless elsewhere.
    """

    FILES_URL = "https://www.googleapis.com/drive/v3/files"
    UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
    SCOPES = ("https://www.googleapis.com/auth/drive",)
    FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
    TIMEOUT = (5, 60)
    CHUNK_SIZE = 64 * 1024

    def __init__(self) -> None:
        self.root_folder_id = settings.DRIVE_ROOT_FOLDER_ID

    @property
    def available(self) -> bool:
        return bool(self.root_folder_id and settings.DRIVE_CREDENTIALS_JSON)

    @cached_property
    def _session(self) -> AuthorizedSession:
        try:
            credentials, _ = google.auth.load_credentials_from_dict(
                json.loads(settings.DRIVE_CREDENTIALS_JSON), scopes=self.SCOPES
            )
        except (ValueError, google.auth.exceptions.GoogleAuthError) as error:
            logger.error("DRIVE_CREDENTIALS_JSON could not be loaded: %s", error)
            raise StorageError("Image storage is not set up correctly.") from error
        return AuthorizedSession(credentials)

    def _call(self, method: str, url: str, **kwargs) -> requests.Response:
        if not self.available:
            raise StorageError("Image storage has not been set up yet.")
        try:
            response = self._session.request(method, url, timeout=self.TIMEOUT, **kwargs)
        except (requests.RequestException, google.auth.exceptions.GoogleAuthError) as error:
            logger.warning("Drive request failed: %s", error)
            raise StorageError("Google Drive could not be reached. Try again.") from error
        if not response.ok:
            # The body names the reason, such as storageQuotaExceeded, which is
            # what an operator needs and nothing a user can act on.
            logger.error("Drive returned %s: %s", response.status_code, response.text[:500])
            raise StorageError("Google Drive refused the request. Try again later.")
        return response

    def create_folder(self, name: str, parent_id: str) -> str:
        response = self._call(
            "POST",
            self.FILES_URL,
            params={"supportsAllDrives": "true", "fields": "id"},
            json={"name": name, "mimeType": self.FOLDER_MIME_TYPE, "parents": [parent_id]},
        )
        return response.json()["id"]

    def upload(self, name: str, content: bytes, content_type: str, parent_id: str) -> str:
        session = self._call(
            "POST",
            self.UPLOAD_URL,
            params={"uploadType": "resumable", "supportsAllDrives": "true", "fields": "id"},
            headers={
                "X-Upload-Content-Type": content_type,
                "X-Upload-Content-Length": str(len(content)),
            },
            json={"name": name, "parents": [parent_id]},
        )
        response = self._call(
            "PUT",
            session.headers["Location"],
            headers={"Content-Type": content_type},
            data=content,
        )
        return response.json()["id"]

    def open(self, file_id: str) -> Iterator[bytes]:
        response = self._call(
            "GET",
            f"{self.FILES_URL}/{file_id}",
            params={"alt": "media", "supportsAllDrives": "true"},
            stream=True,
        )
        return response.iter_content(chunk_size=self.CHUNK_SIZE)

    def thumbnail(self, file_id: str, size: int) -> Thumbnail | None:
        # Drive documents `thumbnailLink` as needing a credentialed fetch for
        # files that are not public. It is absent for a while after an upload,
        # so any failure here means "serve the original", not an error.
        try:
            metadata = self._call(
                "GET",
                f"{self.FILES_URL}/{file_id}",
                params={"fields": "thumbnailLink", "supportsAllDrives": "true"},
            ).json()
            link = metadata.get("thumbnailLink")
            if not link:
                return None
            response = self._call("GET", re.sub(r"=s\d+$", f"=s{size}", link))
        except StorageError:
            return None
        content_type = response.headers.get("Content-Type", "").split(";")[0].strip()
        if content_type not in {"image/jpeg", "image/png", "image/webp"}:
            return None
        return Thumbnail(response.content, content_type)

    def start_resumable(self, name: str, content_type: str, size: int, parent_id: str) -> str:
        response = self._call(
            "POST",
            self.UPLOAD_URL,
            params={"uploadType": "resumable", "supportsAllDrives": "true", "fields": "id"},
            headers={"X-Upload-Content-Type": content_type, "X-Upload-Content-Length": str(size)},
            json={"name": name, "parents": [parent_id]},
        )
        return response.headers["Location"]

    @staticmethod
    def _received_from(response: requests.Response) -> int:
        # A 308 carries `Range: bytes=0-N`, or no header if nothing has landed.
        match = re.fullmatch(r"bytes=0-(\d+)", response.headers.get("Range", ""))
        return int(match.group(1)) + 1 if match else 0

    def send_chunk(self, session: str, content: bytes, offset: int, total: int) -> str | None:
        response = self._call(
            "PUT",
            session,
            headers={"Content-Range": f"bytes {offset}-{offset + len(content) - 1}/{total}"},
            data=content,
            allow_redirects=False,
        )
        if response.status_code == 308:
            return None
        return response.json()["id"]

    def query_resumable(self, session: str, total: int) -> ResumableProgress:
        response = self._call(
            "PUT",
            session,
            headers={"Content-Range": f"bytes */{total}"},
            allow_redirects=False,
        )
        if response.status_code == 308:
            return ResumableProgress(self._received_from(response))
        return ResumableProgress(total, response.json()["id"])

    def open_range(self, file_id: str, byte_range: str | None) -> RangedStream:
        response = self._call(
            "GET",
            f"{self.FILES_URL}/{file_id}",
            params={"alt": "media", "supportsAllDrives": "true"},
            headers={"Range": byte_range} if byte_range else {},
            stream=True,
        )
        length = response.headers.get("Content-Length")
        return RangedStream(
            response.iter_content(chunk_size=self.CHUNK_SIZE),
            response.status_code,
            int(length) if length else None,
            response.headers.get("Content-Range"),
        )


class LocalStorage:
    """Files on local disk, under ``DRIVE_LOCAL_ROOT``.

    For development and tests. That setting exists only in those settings
    modules, so this backend cannot run in production by accident. Ids are paths
    relative to the root, which mirrors the layout Drive would have.
    """

    root_folder_id = ""
    available = True

    def __init__(self) -> None:
        self._root = Path(settings.DRIVE_LOCAL_ROOT)

    @staticmethod
    def _segment(name: str) -> str:
        return name.replace("/", "-").replace("\\", "-").replace("\0", "")[:100]

    def create_folder(self, name: str, parent_id: str) -> str:
        folder_id = f"{parent_id}/{self._segment(name)}".lstrip("/")
        (self._root / folder_id).mkdir(parents=True, exist_ok=True)
        return folder_id

    def upload(self, name: str, content: bytes, content_type: str, parent_id: str) -> str:
        file_id = f"{parent_id}/{uuid.uuid4().hex}-{self._segment(name)}".lstrip("/")
        path = self._root / file_id
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return file_id

    def open(self, file_id: str) -> Iterator[bytes]:
        try:
            return iter([(self._root / file_id).read_bytes()])
        except OSError as error:
            raise StorageError("That file is missing from storage.") from error

    def thumbnail(self, file_id: str, size: int) -> Thumbnail | None:
        return None

    def start_resumable(self, name: str, content_type: str, size: int, parent_id: str) -> str:
        file_id = f"{parent_id}/{uuid.uuid4().hex}-{self._segment(name)}".lstrip("/")
        path = self._root / f"{file_id}.part"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"")
        return file_id

    def send_chunk(self, session: str, content: bytes, offset: int, total: int) -> str | None:
        path = self._root / f"{session}.part"
        with path.open("ab") as part:
            part.write(content)
        if offset + len(content) < total:
            return None
        path.rename(self._root / session)
        return session

    def query_resumable(self, session: str, total: int) -> ResumableProgress:
        path = self._root / f"{session}.part"
        if path.exists():
            return ResumableProgress(path.stat().st_size)
        return ResumableProgress(total, session)

    def open_range(self, file_id: str, byte_range: str | None) -> RangedStream:
        try:
            content = (self._root / file_id).read_bytes()
        except OSError as error:
            raise StorageError("That file is missing from storage.") from error
        total = len(content)
        if not byte_range or byte_range == "bytes=-":
            return RangedStream(iter([content]), 200, total)
        start_text, end_text = byte_range.removeprefix("bytes=").split("-")
        start = int(start_text) if start_text else max(0, total - int(end_text))
        end = min(int(end_text), total - 1) if start_text and end_text else total - 1
        part = content[start : end + 1]
        return RangedStream(iter([part]), 206, len(part), f"bytes {start}-{end}/{total}")


@cache
def get_storage() -> Storage:
    return import_string(settings.DRIVE_STORAGE_BACKEND)()


def _ensure_folder(project, semester, section, name, parent_id, storage: Storage) -> str:
    existing = DriveFolder.objects.filter(
        project=project, semester=semester, section=section
    ).first()
    if existing is not None:
        return existing.folder_id
    folder_id = storage.create_folder(name, parent_id)
    DriveFolder.objects.create(
        project=project, semester=semester, section=section, folder_id=folder_id
    )
    return folder_id


def semester_folder(project, semester, storage: Storage, section: str = "") -> str:
    """The folder holding ``project``'s files for ``semester``, created if needed.

    With a ``section`` the path is ``Project/Section/Term``, which keeps that
    section out of the term folders people may share.
    """
    known = DriveFolder.objects.filter(project=project, semester=semester, section=section).first()
    if known is not None:
        return known.folder_id

    # The first upload of a term holds this lock across the Drive call, so two
    # uploads racing cannot each create a folder. Every later upload returned above.
    with transaction.atomic():
        type(project).objects.select_for_update().get(pk=project.pk)
        parent = _ensure_folder(project, None, "", project.name, storage.root_folder_id, storage)
        if section:
            parent = _ensure_folder(project, None, section, section, parent, storage)
        return _ensure_folder(project, semester, section, semester.name, parent, storage)
