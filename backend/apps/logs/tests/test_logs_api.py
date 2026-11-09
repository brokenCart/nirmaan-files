import datetime

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.conftest import DailyLogFactory, ProjectFactory
from apps.logs.models import DailyLog, LogImage, LogKind, LogStatus

pytestmark = pytest.mark.django_db


def days_ago(n: int) -> datetime.date:
    """A date `n` days back.

    Dates are relative rather than hardcoded because `occurred_on` decides
    which semester an entry lands in, and a fixed calendar date drifts out of
    the open term as time passes.
    """
    return timezone.localdate() - datetime.timedelta(days=n)


def log_payload(project, **overrides):
    payload = {
        "project": project.pk,
        "kind": LogKind.MOV,
        "title": "Visited the community centre",
        "body": "Ran the weekly session.",
        "occurred_on": days_ago(1).isoformat(),
    }
    payload.update(overrides)
    return payload


class TestTimelineVisibility:
    def test_entries_list_their_images_without_extra_queries_per_entry(
        self, auth_client, volunteer, project, django_assert_max_num_queries
    ):
        for index in range(3):
            log = DailyLogFactory(project=project)
            LogImage.objects.create(
                log=log,
                drive_file_id=f"file-{index}",
                original_name="a.jpg",
                content_type="image/jpeg",
                size_bytes=1,
            )
        with django_assert_max_num_queries(12):
            response = auth_client(volunteer).get(reverse("log-list"))
        assert [len(row["images"]) for row in response.data["results"]] == [1, 1, 1]

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
            DailyLogFactory(project=project, occurred_on=days_ago(day))
        response = auth_client(lead).get(reverse("log-list"), {"project": project.slug})
        dates = [row["occurred_on"] for row in response.data["results"]]
        assert dates == sorted(dates, reverse=True)

    def test_filter_by_kind(self, auth_client, lead, project):
        DailyLogFactory(project=project, kind=LogKind.MOV, title="visit")
        DailyLogFactory(project=project, kind=LogKind.MOM, title="meeting")
        response = auth_client(lead).get(reverse("log-list"), {"kind": LogKind.MOM})
        assert [row["title"] for row in response.data["results"]] == ["meeting"]


class TestTimelineSearch:
    def search(self, client, project, q):
        response = client.get(reverse("log-list"), {"project": project.slug, "q": q})
        assert response.status_code == 200
        return {row["title"] for row in response.data["results"]}

    def test_matches_title_and_body_case_insensitively(self, auth_client, lead, project):
        DailyLogFactory(project=project, title="Village school visit", body="Ran a quiz.")
        DailyLogFactory(project=project, title="Core sync", body="Planned the QUIZ night.")
        DailyLogFactory(project=project, title="Budget review", body="Nothing else.")
        assert self.search(auth_client(lead), project, "quiz") == {
            "Village school visit",
            "Core sync",
        }

    def test_matches_author_and_attendees(self, auth_client, lead, volunteer, project):
        DailyLogFactory(project=project, author=volunteer, title="Filed by them")
        attended = DailyLogFactory(project=project, author=lead, title="They attended")
        attended.attendees.add(volunteer)
        DailyLogFactory(project=project, author=lead, title="Unrelated")
        assert self.search(auth_client(lead), project, volunteer.full_name) == {
            "Filed by them",
            "They attended",
        }

    def test_an_entry_matching_several_attendees_appears_once(
        self, auth_client, lead, volunteer, finance_lead, project
    ):
        lead.full_name, volunteer.full_name = "Asha Rao", "Asha Mehta"
        lead.save()
        volunteer.save()
        log = DailyLogFactory(project=project, title="Both Ashas")
        log.attendees.add(lead, volunteer)
        response = auth_client(finance_lead).get(
            reverse("log-list"), {"project": project.slug, "q": "asha"}
        )
        assert response.data["count"] == 1

    def test_search_does_not_reach_hidden_entries(self, auth_client, volunteer, lead, project):
        DailyLogFactory(project=project, author=lead, title="Secret plan", status=LogStatus.DRAFT)
        DailyLogFactory(project=project, title="Secret removed", is_deleted=True)
        assert self.search(auth_client(volunteer), project, "secret") == set()


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


class TestLogHours:
    def create(self, client, project, **overrides):
        return client.post(reverse("log-list"), log_payload(project, **overrides), format="json")

    def test_hours_default_to_one(self, auth_client, volunteer, project):
        response = self.create(auth_client(volunteer), project)
        assert response.status_code == 201
        # A JSON number, not DRF's default decimal string.
        assert response.json()["hours"] == 1

    @pytest.mark.parametrize("hours", [0.5, 1.5, 2, 24])
    def test_half_hour_steps_are_accepted(self, auth_client, volunteer, project, hours):
        response = self.create(auth_client(volunteer), project, hours=hours)
        assert response.status_code == 201
        assert response.json()["hours"] == hours

    @pytest.mark.parametrize("hours", [0, -1, 0.7, 1.25, 24.5, "soon"])
    def test_other_values_are_refused(self, auth_client, volunteer, project, hours):
        response = self.create(auth_client(volunteer), project, hours=hours)
        assert response.status_code == 400
        assert "hours" in response.data

    def test_the_author_can_correct_the_hours(self, auth_client, volunteer, project):
        log = DailyLogFactory(project=project, author=volunteer)
        response = auth_client(volunteer).patch(
            reverse("log-detail", args=[log.pk]), {"hours": 2.5}, format="json"
        )
        assert response.status_code == 200
        log.refresh_from_db()
        assert str(log.hours) == "2.5"

    def test_an_edit_that_omits_hours_leaves_them_alone(self, auth_client, volunteer, project):
        log = DailyLogFactory(project=project, author=volunteer, hours="3.0")
        response = auth_client(volunteer).patch(
            reverse("log-detail", args=[log.pk]), {"title": "Reworded title"}, format="json"
        )
        assert response.status_code == 200
        log.refresh_from_db()
        assert str(log.hours) == "3.0"


class TestEditingIsAuthorOnly:
    """An entry is one person's account, so only they may reword it.

    Staff who disagree with an entry delete it instead — see
    :class:`TestDeleting`.
    """

    @pytest.mark.parametrize("status", [LogStatus.DRAFT, LogStatus.PUBLISHED])
    def test_author_may_edit_their_own_log_at_any_status(
        self, auth_client, volunteer, project, status
    ):
        log = DailyLogFactory(project=project, author=volunteer, status=status)
        response = auth_client(volunteer).patch(
            reverse("log-detail", kwargs={"pk": log.pk}), {"title": "Revised"}
        )
        assert response.status_code == 200
        log.refresh_from_db()
        assert log.title == "Revised"

    def test_author_may_publish_their_own_draft(self, auth_client, volunteer, project):
        log = DailyLogFactory(project=project, author=volunteer, status=LogStatus.DRAFT)
        response = auth_client(volunteer).patch(
            reverse("log-detail", kwargs={"pk": log.pk}), {"status": LogStatus.PUBLISHED}
        )
        assert response.status_code == 200
        log.refresh_from_db()
        assert log.status == LogStatus.PUBLISHED

    @pytest.mark.parametrize("actor", ["lead", "finance_lead", "exec_user"])
    def test_no_role_grants_an_edit_on_someone_elses_log(
        self, request, auth_client, volunteer, project, actor
    ):
        # Leads, finance leads and exec each have write power elsewhere in the
        # project; none of it reaches another member's entry.
        log = DailyLogFactory(project=project, author=volunteer, title="Original")
        user = request.getfixturevalue(actor)
        response = auth_client(user).patch(
            reverse("log-detail", kwargs={"pk": log.pk}), {"title": "Corrected"}
        )
        assert response.status_code == 403
        log.refresh_from_db()
        assert log.title == "Original"

    def test_volunteer_may_not_edit_someone_elses_log(self, auth_client, volunteer, lead, project):
        log = DailyLogFactory(project=project, author=lead, status=LogStatus.PUBLISHED)
        response = auth_client(volunteer).patch(
            reverse("log-detail", kwargs={"pk": log.pk}), {"title": "Not mine"}
        )
        assert response.status_code == 403

    def test_an_edit_cannot_move_an_entry_to_another_project(
        self, auth_client, volunteer, project, other_project
    ):
        # Write permission is judged against the entry's own project, so a
        # reassignment would land it on a timeline the author may not be in.
        log = DailyLogFactory(project=project, author=volunteer)
        response = auth_client(volunteer).patch(
            reverse("log-detail", kwargs={"pk": log.pk}), {"project": other_project.pk}
        )
        assert response.status_code == 400
        log.refresh_from_db()
        assert log.project_id == project.pk


class TestDeleting:
    @pytest.mark.parametrize("actor", ["lead", "finance_lead", "exec_user"])
    def test_staff_may_delete_any_log_in_the_project(
        self, request, auth_client, volunteer, project, actor
    ):
        log = DailyLogFactory(project=project, author=volunteer)
        user = request.getfixturevalue(actor)
        response = auth_client(user).delete(reverse("log-detail", kwargs={"pk": log.pk}))
        assert response.status_code == 204

    def test_author_may_delete_their_own_log(self, auth_client, volunteer, project):
        log = DailyLogFactory(project=project, author=volunteer)
        response = auth_client(volunteer).delete(reverse("log-detail", kwargs={"pk": log.pk}))
        assert response.status_code == 204

    def test_volunteer_may_not_delete_someone_elses_log(
        self, auth_client, volunteer, lead, project
    ):
        log = DailyLogFactory(project=project, author=lead)
        response = auth_client(volunteer).delete(reverse("log-detail", kwargs={"pk": log.pk}))
        assert response.status_code == 403

    def test_delete_is_soft(self, auth_client, lead, project):
        log = DailyLogFactory(project=project)
        response = auth_client(lead).delete(reverse("log-detail", kwargs={"pk": log.pk}))
        assert response.status_code == 204
        log.refresh_from_db()
        assert log.is_deleted is True

    def test_deleted_logs_leave_the_timeline(self, auth_client, lead, project):
        log = DailyLogFactory(project=project, title="Withdrawn")
        auth_client(lead).delete(reverse("log-detail", kwargs={"pk": log.pk}))
        response = auth_client(lead).get(reverse("log-list"), {"project": project.slug})
        assert "Withdrawn" not in {row["title"] for row in response.data["results"]}


class TestAttendees:
    # Attendees are what visit and meeting counts are derived from, so both
    # kinds carry them.
    @pytest.mark.parametrize("kind", [LogKind.MOV, LogKind.MOM])
    def test_either_kind_accepts_attendees(self, auth_client, lead, volunteer, project, kind):
        response = auth_client(lead).post(
            reverse("log-list"),
            log_payload(project, kind=kind, attendee_ids=[volunteer.pk]),
        )
        assert response.status_code == 201
        assert response.data["attendees"][0]["id"] == volunteer.pk

    def test_attendees_default_to_empty(self, auth_client, lead, project):
        response = auth_client(lead).post(reverse("log-list"), log_payload(project))
        assert response.status_code == 201
        assert response.data["attendees"] == []


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
