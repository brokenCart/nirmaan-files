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
