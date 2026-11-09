import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.conftest import DailyLogFactory
from apps.drive import video as video_module
from apps.drive.images import content_url
from apps.drive.storage import StorageError, get_storage
from apps.logs.models import LogVideo, LogVideoStatus
from apps.logs.serializers import LogVideoSerializer

pytestmark = pytest.mark.django_db

UNIT = video_module.CHUNK_UNIT_BYTES
HEAD = b"\x00\x00\x00\x18ftypmp42"


def payload(size):
    return (HEAD + b"x" * size)[:size]


def start(client, log, size=UNIT + 10, **overrides):
    body = {"name": "visit.mp4", "size": size, "content_type": "video/mp4", **overrides}
    return client.post(reverse("log-start-video", args=[log.pk]), body, format="json")


def send(client, log, video_id, offset, data):
    return client.post(
        reverse("log-video-chunk", args=[log.pk, video_id]),
        {"offset": offset, "chunk": SimpleUploadedFile("chunk", data)},
        format="multipart",
    )


def upload_all(client, log, data=None):
    data = data if data is not None else payload(UNIT + 10)
    video_id = start(client, log, size=len(data)).data["id"]
    assert send(client, log, video_id, 0, data[:UNIT]).status_code == 200
    assert send(client, log, video_id, UNIT, data[UNIT:]).status_code == 200
    return LogVideo.objects.get(pk=video_id)


def video_url(video, **kwargs):
    return content_url("log-video-content", video.pk, **kwargs)


def body_of(response):
    return b"".join(response.streaming_content)


@pytest.fixture
def log(project, volunteer):
    return DailyLogFactory(project=project, author=volunteer)


class TestUploading:
    def test_chunks_assemble_in_the_term_folder(
        self, auth_client, volunteer, log, project, semester, isolated_storage
    ):
        data = payload(UNIT + 10)
        video = upload_all(auth_client(volunteer), log, data)

        assert video.status == LogVideoStatus.READY
        assert video.upload_session == ""
        assert video.drive_file_id.startswith(f"{project.name}/{semester.name}/")
        assert (isolated_storage / video.drive_file_id).read_bytes() == data

    def test_only_finished_videos_appear_on_the_entry(self, auth_client, volunteer, log):
        client = auth_client(volunteer)
        data = payload(UNIT + 10)
        video_id = start(client, log, size=len(data)).data["id"]
        send(client, log, video_id, 0, data[:UNIT])
        detail = reverse("log-detail", args=[log.pk])

        assert client.get(detail).data["videos"] == []
        send(client, log, video_id, UNIT, data[UNIT:])
        assert len(client.get(detail).data["videos"]) == 1

    def test_a_repeated_chunk_is_not_sent_twice(self, auth_client, volunteer, log):
        client = auth_client(volunteer)
        data = payload(UNIT + 10)
        video_id = start(client, log, size=len(data)).data["id"]
        send(client, log, video_id, 0, data[:UNIT])

        response = send(client, log, video_id, 0, data[:UNIT])

        assert response.data["bytes_received"] == UNIT

    def test_resending_the_last_chunk_reports_it_complete(self, auth_client, volunteer, log):
        client = auth_client(volunteer)
        data = payload(UNIT + 10)
        video = upload_all(client, log, data)

        response = send(client, log, video.pk, UNIT, data[UNIT:])

        assert response.data["is_complete"] is True

    def test_failed_chunk_is_a_503_and_resumes_from_drives_position(
        self, auth_client, volunteer, log, monkeypatch
    ):
        client = auth_client(volunteer)
        data = payload(UNIT * 2 + 10)
        video_id = start(client, log, size=len(data)).data["id"]
        storage = get_storage()
        real_send = storage.send_chunk

        def fail(*args):
            raise StorageError("Google Drive could not be reached. Try again.")

        monkeypatch.setattr(storage, "send_chunk", fail)
        assert send(client, log, video_id, 0, data[:UNIT]).status_code == 503
        assert LogVideo.objects.get(pk=video_id).needs_sync

        monkeypatch.setattr(storage, "send_chunk", real_send)
        assert send(client, log, video_id, 0, data[:UNIT]).data["bytes_received"] == UNIT
        assert not LogVideo.objects.get(pk=video_id).needs_sync

    def test_drive_failing_during_the_resume_check_is_a_503(
        self, auth_client, volunteer, log, monkeypatch
    ):
        client = auth_client(volunteer)
        video_id = start(client, log).data["id"]
        LogVideo.objects.filter(pk=video_id).update(needs_sync=True)

        def fail(*args):
            raise StorageError("Google Drive could not be reached. Try again.")

        monkeypatch.setattr(get_storage(), "query_resumable", fail)
        assert send(client, log, video_id, 0, payload(UNIT)).status_code == 503
        assert LogVideo.objects.get(pk=video_id).needs_sync

    def test_rejects_a_file_that_is_not_a_video(self, auth_client, volunteer, log):
        client = auth_client(volunteer)
        video_id = start(client, log, size=20).data["id"]

        assert send(client, log, video_id, 0, b"<script>alert(1)</script>"[:20]).status_code == 400
        assert LogVideo.objects.get(pk=video_id).is_deleted

    def test_rejects_a_misaligned_chunk(self, auth_client, volunteer, log):
        client = auth_client(volunteer)
        video_id = start(client, log, size=UNIT * 2).data["id"]
        assert send(client, log, video_id, 0, payload(UNIT - 1)).status_code == 400

    @pytest.mark.parametrize(
        "overrides",
        [
            {"size": video_module.MAX_VIDEO_BYTES + 1},
            {"content_type": "video/x-msvideo"},
            {"size": 0},
        ],
        ids=["too-big", "wrong-type", "empty"],
    )
    def test_refuses_bad_details_before_opening_a_session(
        self, auth_client, volunteer, log, overrides
    ):
        assert start(auth_client(volunteer), log, **overrides).status_code == 400
        assert not LogVideo.objects.exists()

    def test_enforces_the_per_entry_limit(self, auth_client, volunteer, log):
        client = auth_client(volunteer)
        for _ in range(video_module.MAX_VIDEOS_PER_OWNER):
            upload_all(client, log)
        assert start(client, log).status_code == 400


class TestWhoMayChangeVideos:
    def test_only_the_author_starts_or_sends(self, auth_client, volunteer, lead, exec_user, log):
        video_id = start(auth_client(volunteer), log).data["id"]
        for user in (lead, exec_user):
            assert start(auth_client(user), log).status_code == 403
            assert send(auth_client(user), log, video_id, 0, HEAD).status_code == 403

    def test_author_removes_and_it_stops_serving(self, api, auth_client, volunteer, lead, log):
        client = auth_client(volunteer)
        video = upload_all(client, log)
        url = video_url(video)
        remove = reverse("log-remove-video", args=[log.pk, video.pk])

        assert auth_client(lead).delete(remove).status_code == 403
        assert client.delete(remove).status_code == 204
        assert client.get(reverse("log-detail", args=[log.pk])).data["videos"] == []
        assert api.get(url).status_code == 404


class TestServing:
    @pytest.fixture
    def video(self, auth_client, volunteer, log):
        return upload_all(auth_client(volunteer), log)

    def test_whole_file(self, api, video):
        response = api.get(video_url(video))

        assert response.status_code == 200
        assert response["Content-Type"] == "video/mp4"
        assert response["Accept-Ranges"] == "bytes"
        assert body_of(response) == payload(UNIT + 10)

    def test_range_returns_part_of_the_file(self, api, video):
        response = api.get(video_url(video), HTTP_RANGE="bytes=4-7")

        assert response.status_code == 206
        assert response["Content-Range"] == f"bytes 4-7/{UNIT + 10}"
        assert body_of(response) == b"ftyp"

    def test_malformed_range_is_ignored(self, api, video):
        assert api.get(video_url(video), HTTP_RANGE="garbage").status_code == 200

    def test_missing_poster_is_a_404_rather_than_the_whole_video(self, api, video):
        assert api.get(video_url(video, thumbnail=True)).status_code == 404

    def test_wrong_signature_is_refused(self, api, video):
        url = reverse("log-video-content", args=[video.pk])
        assert api.get(f"{url}?exp=9999999999&sig=wrong").status_code == 403

    def test_a_photo_signature_cannot_open_a_video(self, api, video):
        query = content_url("log-image-content", video.pk).split("?")[1]
        url = reverse("log-video-content", args=[video.pk])
        assert api.get(f"{url}?{query}").status_code == 403

    def test_unfinished_video_does_not_serve(self, api, auth_client, volunteer, log):
        video_id = start(auth_client(volunteer), log).data["id"]
        unfinished = LogVideo.objects.get(pk=video_id)
        assert api.get(video_url(unfinished)).status_code == 404

    def test_deleted_entrys_video_stops_serving(self, api, log, video):
        url = video_url(video)
        log.is_deleted = True
        log.save()
        assert api.get(url).status_code == 404

    def test_session_url_is_never_exposed(self, video):
        assert "upload_session" not in LogVideoSerializer(video).data
