import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image

from apps.conftest import DailyLogFactory, MembershipFactory, ReimbursementFactory, UserFactory
from apps.drive.images import MAX_IMAGES_PER_OWNER, content_url
from apps.logs.models import LogImage
from apps.reimbursements.models import ReimbursementReceipt, ReimbursementStatus

pytestmark = pytest.mark.django_db


def upload(client, claim):
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(buffer, format="JPEG")
    file = SimpleUploadedFile("bill.jpg", buffer.getvalue())
    return client.post(
        reverse("reimbursement-add-receipt", args=[claim.pk]), {"image": file}, format="multipart"
    )


def stored_receipt(claim, **overrides):
    defaults = {
        "drive_file_id": f"receipt-{ReimbursementReceipt.objects.count()}",
        "original_name": "bill.jpg",
        "content_type": "image/jpeg",
        "size_bytes": 1,
    }
    return ReimbursementReceipt.objects.create(reimbursement=claim, **{**defaults, **overrides})


def remove_url(claim, receipt):
    return reverse("reimbursement-remove-receipt", args=[claim.pk, receipt.pk])


def receipt_url(receipt, **kwargs):
    return content_url("reimbursement-receipt-content", receipt.pk, **kwargs)


@pytest.fixture
def claim(project, volunteer):
    return ReimbursementFactory(project=project, submitted_by=volunteer)


class TestAttaching:
    def test_submitter_uploads_into_the_private_receipts_folder(
        self, auth_client, volunteer, claim, project, semester, isolated_storage
    ):
        response = upload(auth_client(volunteer), claim)

        assert response.status_code == 201
        receipt = ReimbursementReceipt.objects.get()
        assert receipt.drive_file_id.startswith(f"{project.name}/Receipts/{semester.name}/")
        assert (isolated_storage / receipt.drive_file_id).is_file()

    def test_enforces_the_limit(self, auth_client, volunteer, claim):
        for index in range(MAX_IMAGES_PER_OWNER):
            stored_receipt(claim, drive_file_id=f"limit-{index}")
        assert upload(auth_client(volunteer), claim).status_code == 400

    @pytest.mark.parametrize("status", [ReimbursementStatus.APPROVED, ReimbursementStatus.REJECTED])
    def test_a_decision_freezes_the_receipts(self, auth_client, volunteer, claim, status):
        receipt = stored_receipt(claim)
        claim.status = status
        claim.save()
        client = auth_client(volunteer)

        assert upload(client, claim).status_code == 403
        assert client.delete(remove_url(claim, receipt)).status_code == 403

    def test_reviewers_cannot_add_or_remove(self, auth_client, finance_lead, exec_user, claim):
        receipt = stored_receipt(claim)
        for user in (finance_lead, exec_user):
            assert upload(auth_client(user), claim).status_code == 403
            assert auth_client(user).delete(remove_url(claim, receipt)).status_code == 403

    def test_submitter_removes(self, auth_client, volunteer, claim):
        receipt = stored_receipt(claim)
        client = auth_client(volunteer)

        assert client.delete(remove_url(claim, receipt)).status_code == 204
        detail = client.get(reverse("reimbursement-detail", args=[claim.pk]))
        assert detail.data["receipts"] == []


class TestWhoSeesReceipts:
    def test_the_reviewer_sees_them_in_the_queue(self, auth_client, finance_lead, claim):
        stored_receipt(claim)
        response = auth_client(finance_lead).get(reverse("reimbursement-list"))
        assert len(response.data["results"][0]["receipts"]) == 1

    def test_another_volunteer_gets_no_url_and_cannot_attach(self, auth_client, project, claim):
        stored_receipt(claim)
        other = UserFactory()
        MembershipFactory(user=other, project=project)
        client = auth_client(other)

        assert client.get(reverse("reimbursement-list")).data["results"] == []
        assert upload(client, claim).status_code == 404


class TestServing:
    def test_signed_url_serves_the_file(self, api, auth_client, volunteer, claim):
        upload(auth_client(volunteer), claim)
        response = api.get(receipt_url(ReimbursementReceipt.objects.get()))

        assert response.status_code == 200
        assert b"".join(response.streaming_content).startswith(b"\xff\xd8")

    def test_a_photo_signature_cannot_open_a_receipt_with_the_same_id(self, api, project, claim):
        receipt = stored_receipt(claim)
        photo = LogImage.objects.create(
            pk=receipt.pk,
            log=DailyLogFactory(project=project),
            drive_file_id="photo",
            original_name="a.jpg",
            content_type="image/jpeg",
            size_bytes=1,
        )
        query = content_url("log-image-content", photo.pk).split("?")[1]
        url = reverse("reimbursement-receipt-content", args=[receipt.pk])
        assert api.get(f"{url}?{query}").status_code == 403

    def test_removed_receipt_stops_serving(self, api, claim):
        receipt = stored_receipt(claim)
        url = receipt_url(receipt)
        receipt.is_deleted = True
        receipt.save()
        assert api.get(url).status_code == 404

    def test_withdrawn_claims_receipt_stops_serving(self, api, claim):
        receipt = stored_receipt(claim)
        url = receipt_url(receipt)
        claim.is_deleted = True
        claim.save()
        assert api.get(url).status_code == 404
