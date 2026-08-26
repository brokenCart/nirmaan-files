import datetime

import pytest
from django.urls import reverse

from apps.conftest import DailyLogFactory, ProjectFactory
from apps.logs.models import DailyLog, LogKind, LogStatus

pytestmark = pytest.mark.django_db


def log_payload(project, **overrides):
    payload = {
        "project": project.pk,
        "kind": LogKind.MOV,
        "title": "Visited the community centre",
        "body": "Ran the weekly session.",
        "occurred_on": "2026-08-01",
    }
    payload.update(overrides)
    return payload


class TestTimelineVisibility:
    def test_logs_are_scoped_to_the_users_projects(
        self, auth_client, volunteer, project, other_project
    ):
        DailyLogFactory(project=project, title="Mine")
        DailyLogFactory(project=other_project, title="Not mine")

        response = auth_client(volunteer).get(reverse("log-list"))
        titles = {row["title"] for row in response.data["results"]}
        assert titles == {"Mine"}

    def test_exec_sees_all_projects_logs(self, auth_client, exec_user, project, other_project):
        DailyLogFactory(project=project, title="A")
        DailyLogFactory(project=other_project, title="B")
        response = auth_client(exec_user).get(reverse("log-list"))
        assert {row["title"] for row in response.data["results"]} == {"A", "B"}

    def test_another_persons_draft_is_hidden(self, auth_client, volunteer, lead, project):
        DailyLogFactory(project=project, author=lead, title="Half-written", status=LogStatus.DRAFT)
        response = auth_client(volunteer).get(reverse("log-list"))
        assert response.data["results"] == []

    def test_own_draft_is_visible_to_its_author(self, auth_client, volunteer, project):
        DailyLogFactory(project=project, author=volunteer, title="My draft", status=LogStatus.DRAFT)
        response = auth_client(volunteer).get(reverse("log-list"))
        assert [row["title"] for row in response.data["results"]] == ["My draft"]

    def test_soft_deleted_logs_disappear_from_the_timeline(self, auth_client, lead, project):
        DailyLogFactory(project=project, is_deleted=True)
        assert auth_client(lead).get(reverse("log-list")).data["results"] == []

    def test_timeline_is_reverse_chronological(self, auth_client, lead, project):
        for day in (5, 20, 12):
            DailyLogFactory(project=project, occurred_on=datetime.date(2026, 7, day))
        response = auth_client(lead).get(reverse("log-list"), {"project": project.slug})
        dates = [row["occurred_on"] for row in response.data["results"]]
        assert dates == sorted(dates, reverse=True)

    def test_filter_by_kind(self, auth_client, lead, project):
        DailyLogFactory(project=project, kind=LogKind.MOV, title="visit")
        DailyLogFactory(project=project, kind=LogKind.MOM, title="meeting")
        response = auth_client(lead).get(reverse("log-list"), {"kind": LogKind.MOM})
        assert [row["title"] for row in response.data["results"]] == ["meeting"]


class TestLogWrites:
    @pytest.mark.parametrize(
        ("actor", "expected"),
        [("exec_user", 201), ("lead", 201), ("finance_lead", 201), ("volunteer", 201)],
    )
    def test_every_member_can_file_a_log(self, request, auth_client, project, actor, expected):
        user = request.getfixturevalue(actor)
        response = auth_client(user).post(reverse("log-list"), log_payload(project))
        assert response.status_code == expected

    def test_outsider_cannot_file_a_log_against_a_foreign_project(
        self, auth_client, outsider, project
    ):
        response = auth_client(outsider).post(reverse("log-list"), log_payload(project))
        assert response.status_code == 403

    def test_author_is_taken_from_the_request_not_the_payload(
        self, auth_client, volunteer, lead, project
    ):
        response = auth_client(volunteer).post(
            reverse("log-list"), log_payload(project, author=lead.pk)
        )
        assert response.status_code == 201
        assert DailyLog.objects.get(pk=response.data["id"]).author_id == volunteer.pk

    def test_volunteer_may_edit_their_own_draft(self, auth_client, volunteer, project):
        log = DailyLogFactory(project=project, author=volunteer, status=LogStatus.DRAFT)
        response = auth_client(volunteer).patch(
            reverse("log-detail", kwargs={"pk": log.pk}), {"title": "Revised"}
        )
        assert response.status_code == 200

    def test_volunteer_may_not_edit_their_own_published_log(self, auth_client, volunteer, project):
        log = DailyLogFactory(project=project, author=volunteer, status=LogStatus.PUBLISHED)
        response = auth_client(volunteer).patch(
            reverse("log-detail", kwargs={"pk": log.pk}), {"title": "Sneaky edit"}
        )
        assert response.status_code == 403

    def test_volunteer_may_not_edit_someone_elses_log(self, auth_client, volunteer, lead, project):
        log = DailyLogFactory(project=project, author=lead, status=LogStatus.PUBLISHED)
        response = auth_client(volunteer).patch(
            reverse("log-detail", kwargs={"pk": log.pk}), {"title": "Not mine"}
        )
        assert response.status_code == 403

    @pytest.mark.parametrize("actor", ["lead", "finance_lead", "exec_user"])
    def test_staff_may_edit_any_log_in_the_project(
        self, request, auth_client, volunteer, project, actor
    ):
        log = DailyLogFactory(project=project, author=volunteer, status=LogStatus.PUBLISHED)
        user = request.getfixturevalue(actor)
        response = auth_client(user).patch(
            reverse("log-detail", kwargs={"pk": log.pk}), {"title": "Corrected"}
        )
        assert response.status_code == 200

    def test_delete_is_soft(self, auth_client, lead, project):
        log = DailyLogFactory(project=project)
        response = auth_client(lead).delete(reverse("log-detail", kwargs={"pk": log.pk}))
        assert response.status_code == 204
        log.refresh_from_db()
        assert log.is_deleted is True


class TestKindSpecificFields:
    def test_mom_rejects_a_location(self, auth_client, lead, project):
        response = auth_client(lead).post(
            reverse("log-list"),
            log_payload(project, kind=LogKind.MOM, location="Village square"),
        )
        assert response.status_code == 400
        assert "location" in response.data

    def test_mov_rejects_attendees(self, auth_client, lead, volunteer, project):
        response = auth_client(lead).post(
            reverse("log-list"),
            log_payload(project, kind=LogKind.MOV, attendee_ids=[volunteer.pk]),
        )
        assert response.status_code == 400

    def test_mom_accepts_attendees(self, auth_client, lead, volunteer, project):
        response = auth_client(lead).post(
            reverse("log-list"),
            log_payload(project, kind=LogKind.MOM, attendee_ids=[volunteer.pk]),
        )
        assert response.status_code == 201
        assert response.data["attendees"][0]["id"] == volunteer.pk


class TestQueryEfficiency:
    def test_timeline_does_not_scale_queries_with_row_count(
        self, auth_client, django_assert_max_num_queries, lead, project
    ):
        for _ in range(10):
            DailyLogFactory(project=project)
        client = auth_client(lead)
        # Membership lookup is cached per request and relations are prefetched,
        # so query count must stay flat as the timeline grows.
        with django_assert_max_num_queries(8):
            client.get(reverse("log-list"), {"project": project.slug})


class TestProjectlessAccess:
    def test_new_user_with_no_memberships_sees_nothing(self, auth_client, db):
        from apps.conftest import UserFactory

        newcomer = UserFactory(email="newcomer@pilani.bits-pilani.ac.in")
        ProjectFactory(name="Something")
        DailyLogFactory()
        client = auth_client(newcomer)
        assert client.get(reverse("project-list")).data["results"] == []
        assert client.get(reverse("log-list")).data["results"] == []
