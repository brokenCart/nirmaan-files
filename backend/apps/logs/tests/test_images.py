import io
import time

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image

from apps.conftest import DailyLogFactory
from apps.drive import images as image_module
from apps.drive.images import MAX_IMAGES_PER_OWNER as MAX_IMAGES_PER_LOG
from apps.drive.models import DriveFolder
from apps.drive.storage import StorageError, get_storage
from apps.logs.models import LogImage, LogStatus

pytestmark = pytest.mark.django_db


def image_file(name="photo.jpg", image_format="JPEG"):
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(buffer, format=image_format)
    return SimpleUploadedFile(name, buffer.getvalue())


def content_url(pk, **kwargs):
    return image_module.content_url("log-image-content", pk, **kwargs)


def upload_url(log):
    return reverse("log-add-image", args=[log.pk])


def upload(client, log, file=None):
    return client.post(upload_url(log), {"image": file or image_file()}, format="multipart")


def stored_image(log, **overrides):
    defaults = {
        "drive_file_id": f"file-{LogImage.objects.count()}",
        "original_name": "a.jpg",
        "content_type": "image/jpeg",
        "size_bytes": 1,
    }
    return LogImage.objects.create(log=log, **{**defaults, **overrides})


def body_of(response) -> bytes:
    return b"".join(response.streaming_content)


@pytest.fixture
def log(project, volunteer):
    return DailyLogFactory(project=project, author=volunteer)


class TestUpload:
    def test_author_uploads_into_the_project_and_term_folder(
        self, auth_client, volunteer, log, project, semester, isolated_storage
    ):
        response = upload(auth_client(volunteer), log)

        assert response.status_code == 201
        image = LogImage.objects.get()
        assert image.content_type == "image/jpeg"
        assert image.drive_file_id.startswith(f"{project.name}/{semester.name}/")
        assert (isolated_storage / image.drive_file_id).is_file()

    def test_folders_are_created_once(self, auth_client, volunteer, log):
        client = auth_client(volunteer)
        upload(client, log)
        upload(client, log)
        assert DriveFolder.objects.count() == 2

    def test_type_comes_from_the_bytes_not_the_name(self, auth_client, volunteer, log):
        response = upload(auth_client(volunteer), log, image_file("photo.jpg", "PNG"))
        assert response.status_code == 201
        assert response.data["content_type"] == "image/png"

    def test_rejects_something_that_is_not_an_image(self, auth_client, volunteer, log):
        fake = SimpleUploadedFile("photo.jpg", b"<script>alert(1)</script>")
        response = upload(auth_client(volunteer), log, fake)
        assert response.status_code == 400
        assert not LogImage.objects.exists()

    def test_rejects_a_real_image_of_a_disallowed_format(self, auth_client, volunteer, log):
        response = upload(auth_client(volunteer), log, image_file("photo.gif", "GIF"))
        assert response.status_code == 400

    def test_rejects_oversized_files(self, auth_client, volunteer, log, monkeypatch):
        monkeypatch.setattr(image_module, "MAX_IMAGE_BYTES", 10)
        assert upload(auth_client(volunteer), log).status_code == 400

    def test_enforces_the_per_entry_limit(self, auth_client, volunteer, log):
        for index in range(MAX_IMAGES_PER_LOG):
            stored_image(log, drive_file_id=f"limit-{index}")
        assert upload(auth_client(volunteer), log).status_code == 400

    def test_removed_images_do_not_count_towards_the_limit(self, auth_client, volunteer, log):
        for index in range(MAX_IMAGES_PER_LOG):
            stored_image(log, drive_file_id=f"limit-{index}", is_deleted=True)
        assert upload(auth_client(volunteer), log).status_code == 201

    def test_storage_failure_is_a_503_and_records_nothing(
        self, auth_client, volunteer, log, monkeypatch
    ):
        def fail(*args, **kwargs):
            raise StorageError("Google Drive could not be reached. Try again.")

        monkeypatch.setattr(get_storage(), "upload", fail)
        response = upload(auth_client(volunteer), log)
        assert response.status_code == 503
        assert "could not be reached" in response.data["detail"]
        assert not LogImage.objects.exists()


class TestWhoMayChangeImages:
    def test_only_the_author_uploads(self, auth_client, lead, exec_user, log):
        assert upload(auth_client(lead), log).status_code == 403
        assert upload(auth_client(exec_user), log).status_code == 403

    def test_author_removes(self, auth_client, volunteer, log):
        image = stored_image(log)
        url = reverse("log-remove-image", args=[log.pk, image.pk])

        assert auth_client(volunteer).delete(url).status_code == 204
        image.refresh_from_db()
        assert image.is_deleted
        detail = auth_client(volunteer).get(reverse("log-detail", args=[log.pk]))
        assert detail.data["images"] == []

    def test_lead_cannot_remove_one_image(self, auth_client, lead, log):
        image = stored_image(log)
        url = reverse("log-remove-image", args=[log.pk, image.pk])
        assert auth_client(lead).delete(url).status_code == 403

    def test_image_from_another_entry_is_a_404(self, auth_client, volunteer, log, project):
        other = stored_image(DailyLogFactory(project=project, author=volunteer))
        url = reverse("log-remove-image", args=[log.pk, other.pk])
        assert auth_client(volunteer).delete(url).status_code == 404


class TestServing:
    def serve(self, api, image, **kwargs):
        return api.get(content_url(image.pk, **kwargs))

    def test_signed_url_serves_without_a_token(self, api, auth_client, volunteer, log):
        upload(auth_client(volunteer), log)
        response = self.serve(api, LogImage.objects.get())

        assert response.status_code == 200
        assert response["Content-Type"] == "image/jpeg"
        assert response["Cache-Control"].startswith("private")
        assert body_of(response).startswith(b"\xff\xd8")

    def test_thumbnail_falls_back_to_the_original(self, api, auth_client, volunteer, log):
        upload(auth_client(volunteer), log)
        response = self.serve(api, LogImage.objects.get(), thumbnail=True)
        assert body_of(response).startswith(b"\xff\xd8")

    def test_missing_or_wrong_signature_is_refused(self, api, log):
        image = stored_image(log)
        url = reverse("log-image-content", args=[image.pk])
        assert api.get(url).status_code == 403
        assert api.get(f"{url}?exp=9999999999&sig=wrong").status_code == 403

    def test_a_signature_does_not_work_for_another_image(self, api, log):
        first, second = stored_image(log), stored_image(log)
        query = content_url(first.pk).split("?")[1]
        url = reverse("log-image-content", args=[second.pk])
        assert api.get(f"{url}?{query}").status_code == 403

    def test_expired_url_is_refused(self, api, log, monkeypatch):
        image = stored_image(log)
        url = content_url(image.pk)
        real_time = time.time
        monkeypatch.setattr(image_module.time, "time", lambda: real_time() + 3 * 60 * 60)
        assert api.get(url).status_code == 403

    def test_removed_image_stops_serving_at_once(self, api, log):
        image = stored_image(log)
        url = content_url(image.pk)
        image.is_deleted = True
        image.save()
        assert api.get(url).status_code == 404

    def test_deleted_entrys_image_stops_serving(self, api, log):
        image = stored_image(log)
        url = content_url(image.pk)
        log.is_deleted = True
        log.save()
        assert api.get(url).status_code == 404

    def test_storage_failure_is_a_502(self, api, log):
        image = stored_image(log, drive_file_id="does/not/exist")
        assert self.serve(api, image).status_code == 502


class TestDraftPrivacy:
    def test_draft_image_urls_reach_only_the_author(self, auth_client, volunteer, lead, project):
        draft = DailyLogFactory(project=project, author=volunteer, status=LogStatus.DRAFT)
        stored_image(draft)

        mine = auth_client(volunteer).get(reverse("log-list"))
        theirs = auth_client(lead).get(reverse("log-list"))

        assert len(mine.data["results"][0]["images"]) == 1
        assert theirs.data["results"] == []
