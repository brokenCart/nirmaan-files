import pytest
from django.urls import reverse

from apps.conftest import DailyLogFactory, MembershipFactory, UserFactory
from apps.logs.models import LogKind, LogStatus

pytestmark = pytest.mark.django_db


def attendance_url(project):
    return reverse("project-attendance", kwargs={"slug": project.slug})


def export_url(project):
    return reverse("project-attendance-export", kwargs={"slug": project.slug})


def row_for(response, user):
    return next(row for row in response.data if row["user"]["id"] == user.pk)


def attended(project, attendees, **kwargs):
    log = DailyLogFactory(project=project, **kwargs)
    log.attendees.set(attendees)
    return log


class TestAttendanceCounts:
    def test_counts_visits_and_meetings_separately(self, auth_client, lead, volunteer, project):
        attended(project, [volunteer], kind=LogKind.MOV)
        attended(project, [volunteer], kind=LogKind.MOV)
        attended(project, [volunteer], kind=LogKind.MOM)

        response = auth_client(lead).get(attendance_url(project))
        row = row_for(response, volunteer)
        assert (row["visits"], row["meetings"], row["total"]) == (2, 1, 3)

    def test_members_with_no_attendance_still_appear(self, auth_client, lead, volunteer, project):
        response = auth_client(lead).get(attendance_url(project))
        row = row_for(response, volunteer)
        assert (row["visits"], row["meetings"], row["total"]) == (0, 0, 0)

    def test_authoring_a_log_is_not_attending_it(self, auth_client, lead, volunteer, project):
        # Counts come from the attendee list alone, so filing a report about a
        # visit you did not go on does not credit you with the visit.
        DailyLogFactory(project=project, author=volunteer, kind=LogKind.MOV)
        response = auth_client(lead).get(attendance_url(project))
        assert row_for(response, volunteer)["visits"] == 0

    def test_drafts_are_not_counted(self, auth_client, lead, volunteer, project):
        # A draft is private to its author; counting it would leak its
        # existence to everyone reading the table.
        attended(project, [volunteer], kind=LogKind.MOV, status=LogStatus.DRAFT)
        response = auth_client(lead).get(attendance_url(project))
        assert row_for(response, volunteer)["visits"] == 0

    def test_deleted_logs_are_not_counted(self, auth_client, lead, volunteer, project):
        log = attended(project, [volunteer], kind=LogKind.MOV)
        log.is_deleted = True
        log.save(update_fields=["is_deleted"])

        response = auth_client(lead).get(attendance_url(project))
        assert row_for(response, volunteer)["visits"] == 0

    def test_another_projects_logs_are_not_counted(
        self, auth_client, lead, volunteer, project, other_project
    ):
        MembershipFactory(user=volunteer, project=other_project)
        attended(other_project, [volunteer], kind=LogKind.MOV)

        response = auth_client(lead).get(attendance_url(project))
        assert row_for(response, volunteer)["visits"] == 0

    def test_inactive_members_are_left_out(self, auth_client, lead, project):
        former = UserFactory(email="former@pilani.bits-pilani.ac.in")
        MembershipFactory(user=former, project=project, is_active=False)

        response = auth_client(lead).get(attendance_url(project))
        assert former.pk not in {row["user"]["id"] for row in response.data}

    def test_ordered_by_visits_descending(self, auth_client, lead, volunteer, project):
        attended(project, [volunteer], kind=LogKind.MOV)
        response = auth_client(lead).get(attendance_url(project))
        assert response.data[0]["user"]["id"] == volunteer.pk

    def test_one_query_regardless_of_roster_size(
        self, auth_client, django_assert_max_num_queries, lead, project
    ):
        for index in range(10):
            member = UserFactory(email=f"m{index}@pilani.bits-pilani.ac.in")
            MembershipFactory(user=member, project=project)
            attended(project, [member], kind=LogKind.MOV)

        client = auth_client(lead)
        # Counts are annotated, so the table must not issue a query per member.
        with django_assert_max_num_queries(6):
            client.get(attendance_url(project))


class TestAttendanceAccess:
    @pytest.mark.parametrize("actor", ["lead", "finance_lead", "volunteer", "exec_user"])
    def test_any_member_may_read_the_table(self, request, auth_client, project, actor):
        user = request.getfixturevalue(actor)
        assert auth_client(user).get(attendance_url(project)).status_code == 200

    def test_outsider_gets_404_not_403(self, auth_client, outsider, project):
        # 403 would confirm the project exists — the same rule as everywhere.
        assert auth_client(outsider).get(attendance_url(project)).status_code == 404

    def test_anonymous_is_refused(self, api, project):
        assert api.get(attendance_url(project)).status_code == 401


class TestAttendanceExport:
    def test_returns_an_xlsx_attachment(self, auth_client, lead, volunteer, project):
        attended(project, [volunteer], kind=LogKind.MOV)
        response = auth_client(lead).get(export_url(project))

        assert response.status_code == 200
        assert response["Content-Type"] == (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        # The term is in the filename: counting restarts each semester, so a
        # download named only for the project would be ambiguous on disk.
        assert f"nirmaan-{project.slug}-" in response["Content-Disposition"]
        assert "-attendance-" in response["Content-Disposition"]
        # A real xlsx is a zip archive.
        assert response.content[:2] == b"PK"

    def test_workbook_carries_the_counts(self, auth_client, lead, volunteer, project):
        import io

        from openpyxl import load_workbook

        attended(project, [volunteer], kind=LogKind.MOV)
        attended(project, [volunteer], kind=LogKind.MOM)

        response = auth_client(lead).get(export_url(project))
        sheet = load_workbook(io.BytesIO(response.content)).active

        rows = [tuple(row) for row in sheet.iter_rows(values_only=True)]
        assert any(row[1] == volunteer.email and row[3:6] == (1, 1, 2) for row in rows)

    def test_outsider_cannot_download_it(self, auth_client, outsider, project):
        assert auth_client(outsider).get(export_url(project)).status_code == 404
