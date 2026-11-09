"""The Drive adapter against a stubbed HTTP session.

Asserts on what would be sent to Google, including the `supportsAllDrives` flag
that Shared Drives silently depend on.
"""

from unittest.mock import MagicMock

import pytest
import requests

from apps.drive.storage import GoogleDriveStorage, StorageError


def reply(status=200, payload=None, headers=None, content=b""):
    response = MagicMock(spec=requests.Response)
    response.ok = status < 400
    response.status_code = status
    response.text = ""
    response.headers = headers or {}
    response.content = content
    response.json.return_value = payload or {}
    return response


@pytest.fixture
def drive(settings):
    settings.DRIVE_ROOT_FOLDER_ID = "root"
    settings.DRIVE_CREDENTIALS_JSON = "{}"
    storage = GoogleDriveStorage()
    # `_session` is a cached_property, so setting it skips loading credentials.
    storage._session = MagicMock()
    return storage


def test_unconfigured_is_unavailable_and_refuses_calls(settings):
    settings.DRIVE_ROOT_FOLDER_ID = ""
    settings.DRIVE_CREDENTIALS_JSON = ""
    storage = GoogleDriveStorage()
    assert not storage.available
    with pytest.raises(StorageError, match="not been set up"):
        storage.create_folder("x", "root")


def test_create_folder(drive):
    drive._session.request.return_value = reply(payload={"id": "folder-1"})

    assert drive.create_folder("Shiksha", "root") == "folder-1"

    kwargs = drive._session.request.call_args.kwargs
    assert kwargs["params"]["supportsAllDrives"] == "true"
    assert kwargs["json"]["parents"] == ["root"]
    assert kwargs["json"]["mimeType"] == GoogleDriveStorage.FOLDER_MIME_TYPE


def test_upload_opens_a_session_then_sends_the_bytes(drive):
    drive._session.request.side_effect = [
        reply(headers={"Location": "https://upload.example/session"}),
        reply(payload={"id": "file-1"}),
    ]

    assert drive.upload("a.jpg", b"bytes", "image/jpeg", "folder") == "file-1"

    start, send = drive._session.request.call_args_list
    assert start.kwargs["params"]["uploadType"] == "resumable"
    assert start.kwargs["params"]["supportsAllDrives"] == "true"
    assert start.kwargs["json"] == {"name": "a.jpg", "parents": ["folder"]}
    assert send.args == ("PUT", "https://upload.example/session")
    assert send.kwargs["data"] == b"bytes"


def test_quota_error_is_a_storage_error_without_google_details(drive):
    drive._session.request.return_value = reply(status=403)
    with pytest.raises(StorageError) as caught:
        drive.create_folder("x", "root")
    assert "quota" not in str(caught.value).lower()


def test_network_failure_is_a_storage_error(drive):
    drive._session.request.side_effect = requests.ConnectionError()
    with pytest.raises(StorageError, match="could not be reached"):
        drive.create_folder("x", "root")


def test_invalid_credentials_are_a_storage_error(settings):
    settings.DRIVE_ROOT_FOLDER_ID = "root"
    settings.DRIVE_CREDENTIALS_JSON = "not json"
    with pytest.raises(StorageError, match="not set up correctly"):
        GoogleDriveStorage().create_folder("x", "root")


def test_thumbnail_requests_the_size_it_wants(drive):
    drive._session.request.side_effect = [
        reply(payload={"thumbnailLink": "https://lh3.example/abc=s220"}),
        reply(headers={"Content-Type": "image/jpeg"}, content=b"thumb"),
    ]

    thumbnail = drive.thumbnail("file", 640)

    assert thumbnail.content == b"thumb"
    assert drive._session.request.call_args.args == ("GET", "https://lh3.example/abc=s640")


@pytest.mark.parametrize(
    "replies",
    [
        [reply(payload={})],
        [reply(status=500)],
        [
            reply(payload={"thumbnailLink": "https://lh3.example/abc=s220"}),
            reply(headers={"Content-Type": "text/html"}),
        ],
    ],
    ids=["not-ready", "metadata-fails", "not-an-image"],
)
def test_thumbnail_problems_fall_back_to_none(drive, replies):
    drive._session.request.side_effect = replies
    assert drive.thumbnail("file", 640) is None


def test_start_resumable_returns_the_session(drive):
    drive._session.request.return_value = reply(headers={"Location": "https://upload/s"})

    assert drive.start_resumable("v.mp4", "video/mp4", 99, "folder") == "https://upload/s"

    kwargs = drive._session.request.call_args.kwargs
    assert kwargs["params"]["supportsAllDrives"] == "true"
    assert kwargs["headers"]["X-Upload-Content-Length"] == "99"


def test_send_chunk_midway_returns_none(drive):
    drive._session.request.return_value = reply(status=308)

    assert drive.send_chunk("https://upload/s", b"abcd", 8, 100) is None

    kwargs = drive._session.request.call_args.kwargs
    assert kwargs["headers"]["Content-Range"] == "bytes 8-11/100"
    assert kwargs["allow_redirects"] is False


def test_send_last_chunk_returns_the_file_id(drive):
    drive._session.request.return_value = reply(status=200, payload={"id": "file-1"})
    assert drive.send_chunk("https://upload/s", b"abcd", 96, 100) == "file-1"


@pytest.mark.parametrize(
    ("headers", "received"),
    [({"Range": "bytes=0-41"}, 42), ({}, 0)],
    ids=["partway", "nothing-yet"],
)
def test_query_reports_what_drive_has(drive, headers, received):
    drive._session.request.return_value = reply(status=308, headers=headers)

    progress = drive.query_resumable("https://upload/s", 100)

    assert progress.received == received
    assert progress.file_id is None
    assert drive._session.request.call_args.kwargs["headers"]["Content-Range"] == "bytes */100"


def test_query_finds_a_finished_upload(drive):
    drive._session.request.return_value = reply(status=200, payload={"id": "file-1"})
    assert drive.query_resumable("https://upload/s", 100).file_id == "file-1"


def test_open_range_forwards_the_range(drive):
    response = reply(status=206, headers={"Content-Length": "4", "Content-Range": "bytes 0-3/9"})
    response.iter_content.return_value = iter([b"abcd"])
    drive._session.request.return_value = response

    stream = drive.open_range("file", "bytes=0-3")

    assert drive._session.request.call_args.kwargs["headers"] == {"Range": "bytes=0-3"}
    assert (stream.status, stream.content_length, stream.content_range) == (206, 4, "bytes 0-3/9")
