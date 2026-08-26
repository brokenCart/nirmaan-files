"""Semester scoping on the timeline, the counts, and the archive.

Three rules are under test here, and they pull against each other:

* the timeline shows **one term at a time**, defaulting to the open one;
* counting **restarts** each term, so a member's totals are per semester;
* a closed term is **frozen** — readable by anyone who was ever a member,
  writable by nobody.
"""

import datetime

import pytest
from django.urls import reverse

from apps.conftest import DailyLogFactory, MembershipFactory, UserFactory
from apps.logs.models import LogKind, LogStatus
from apps.projects.models import Role

pytestmark = pytest.mark.django_db


def archived_log(project, semester, **kwargs):
    """An entry dated inside a term that has already ended."""
    kwargs.setdefault("occurred_on", semester.ends_on - datetime.timedelta(days=1))
    return DailyLogFactory(project=project, **kwargs)


def attended(project, attendees, **kwargs):
    log = DailyLogFactory(project=project, **kwargs)
    log.attendees.set(attendees)
    return log


class TestSemesterStamping:
    def test_an_entry_takes_the_term_its_date_falls_in(self, project, semester, past_semester):
        current = DailyLogFactory(project=project)
        old = archived_log(project, past_semester)

        assert current.semester == semester
        assert old.semester == past_semester

    def test_a_date_before_every_term_is_rejected(
        self, auth_client, volunteer, project, past_semester
    ):
        from apps.logs.tests.test_logs_api import log_payload

        response = auth_client(volunteer).post(
            reverse("log-list"),
            log_payload(
                project,
                occurred_on=(past_semester.starts_on - datetime.timedelta(days=1)).isoformat(),
            ),
        )
        assert response.status_code == 400
        assert "occurred_on" in response.data


class TestTimelineIsScopedToATerm:
    def test_timeline_defaults_to_the_open_term(self, auth_client, lead, project, past_semester):
        DailyLogFactory(project=project, title="This term")
        archived_log(project, past_semester, title="Last term")

        response = auth_client(lead).get(reverse("log-list"), {"project": project.slug})
        assert [row["title"] for row in response.data["results"]] == ["This term"]

    def test_a_past_term_can_be_read_by_slug(self, auth_client, lead, project, past_semester):
        DailyLogFactory(project=project, title="This term")
        archived_log(project, past_semester, title="Last term")

        response = auth_client(lead).get(
            reverse("log-list"), {"project": project.slug, "semester": past_semester.slug}
        )
        assert [row["title"] for row in response.data["results"]] == ["Last term"]

    def test_semester_all_reads_across_terms(self, auth_client, lead, project, past_semester):
        DailyLogFactory(project=project, title="This term")
        archived_log(project, past_semester, title="Last term")

        response = auth_client(lead).get(
            reverse("log-list"), {"project": project.slug, "semester": "all"}
        )
        assert {row["title"] for row in response.data["results"]} == {"This term", "Last term"}

    def test_entries_report_their_term(self, auth_client, lead, project, semester):
        DailyLogFactory(project=project, title="Dated")
        response = auth_client(lead).get(reverse("log-list"), {"project": project.slug})
        assert response.data["results"][0]["semester_slug"] == semester.slug


class TestPastMembersReadButCannotWrite:
    """Read access outlives the membership; write access does not."""

    def test_a_past_member_reads_the_archive_they_wrote(
        self, auth_client, past_lead, project, past_semester
    ):
        archived_log(project, past_semester, author=past_lead, title="What I filed")

        response = auth_client(past_lead).get(
            reverse("log-list"), {"project": project.slug, "semester": past_semester.slug}
        )
        assert [row["title"] for row in response.data["results"]] == ["What I filed"]

    def test_a_past_member_cannot_file_a_new_entry(self, auth_client, past_lead, project):
        from apps.logs.tests.test_logs_api import log_payload

        response = auth_client(past_lead).post(reverse("log-list"), log_payload(project))
        assert response.status_code == 403

    def test_a_past_member_cannot_edit_their_own_archived_entry(
        self, auth_client, past_lead, project, past_semester
    ):
        """Authorship is not enough once the term has closed."""
        log = archived_log(project, past_semester, author=past_lead, title="Original")

        response = auth_client(past_lead).patch(
            reverse("log-detail", kwargs={"pk": log.pk}), {"title": "Rewritten"}
        )
        assert response.status_code == 403
        log.refresh_from_db()
        assert log.title == "Original"

    def test_a_past_member_cannot_delete_their_own_archived_entry(
        self, auth_client, past_lead, project, past_semester
    ):
        log = archived_log(project, past_semester, author=past_lead)
        response = auth_client(past_lead).delete(reverse("log-detail", kwargs={"pk": log.pk}))
        assert response.status_code == 403

    def test_a_dropped_member_cannot_edit_what_they_filed_this_term(
        self, auth_client, past_lead, project
    ):
        """The open-term case, which the frozen-archive rule does not cover.

        Someone taken off this term's roster mid-semester leaves entries behind
        that are still in the open term and still theirs. Authorship alone would
        keep the edit alive; membership is what ends it.
        """
        log = DailyLogFactory(project=project, author=past_lead, title="Original")

        response = auth_client(past_lead).patch(
            reverse("log-detail", kwargs={"pk": log.pk}), {"title": "Rewritten"}
        )
        assert response.status_code == 403
        log.refresh_from_db()
        assert log.title == "Original"

    def test_a_dropped_member_cannot_delete_what_they_filed_this_term(
        self, auth_client, past_lead, project
    ):
        log = DailyLogFactory(project=project, author=past_lead)
        response = auth_client(past_lead).delete(reverse("log-detail", kwargs={"pk": log.pk}))
        assert response.status_code == 403
        log.refresh_from_db()
        assert log.is_deleted is False

    def test_a_dropped_member_still_reads_this_terms_timeline(
        self, auth_client, past_lead, project
    ):
        """Losing the roster spot does not un-read the feed."""
        DailyLogFactory(project=project, title="Filed after they left")

        response = auth_client(past_lead).get(reverse("log-list"), {"project": project.slug})
        assert [row["title"] for row in response.data["results"]] == ["Filed after they left"]


class TestClosedTermsAreFrozen:
    def test_the_author_cannot_edit_an_archived_entry(
        self, auth_client, volunteer, project, past_semester
    ):
        log = archived_log(project, past_semester, author=volunteer, title="Original")
        response = auth_client(volunteer).patch(
            reverse("log-detail", kwargs={"pk": log.pk}), {"title": "Rewritten"}
        )
        assert response.status_code == 403

    def test_the_current_lead_cannot_delete_an_archived_entry(
        self, auth_client, lead, volunteer, project, past_semester
    ):
        log = archived_log(project, past_semester, author=volunteer)
        response = auth_client(lead).delete(reverse("log-detail", kwargs={"pk": log.pk}))
        assert response.status_code == 403

    def test_exec_keeps_the_moderation_lever_over_the_archive(
        self, auth_client, exec_user, volunteer, project, past_semester
    ):
        """Something that should never have been published stays removable."""
        log = archived_log(project, past_semester, author=volunteer)
        response = auth_client(exec_user).delete(reverse("log-detail", kwargs={"pk": log.pk}))
        assert response.status_code == 204
        log.refresh_from_db()
        assert log.is_deleted is True

    def test_backdating_into_a_closed_term_is_refused(
        self, auth_client, volunteer, project, past_semester
    ):
        """Otherwise the frozen-archive rule is one date field away from moot."""
        from apps.logs.tests.test_logs_api import log_payload

        response = auth_client(volunteer).post(
            reverse("log-list"),
            log_payload(
                project,
                occurred_on=(past_semester.ends_on - datetime.timedelta(days=1)).isoformat(),
            ),
        )
        assert response.status_code == 403

    def test_an_entry_in_the_open_term_is_still_editable(self, auth_client, volunteer, project):
        log = DailyLogFactory(project=project, author=volunteer, title="Original")
        response = auth_client(volunteer).patch(
            reverse("log-detail", kwargs={"pk": log.pk}), {"title": "Corrected"}
        )
        assert response.status_code == 200


class TestCountingRestartsEachTerm:
    def test_attendance_defaults_to_the_open_term(
        self, auth_client, lead, volunteer, project, past_semester
    ):
        attended(project, [volunteer], kind=LogKind.MOV)
        attended(
            project,
            [volunteer],
            kind=LogKind.MOV,
            occurred_on=past_semester.ends_on - datetime.timedelta(days=1),
        )

        response = auth_client(lead).get(
            reverse("project-attendance", kwargs={"slug": project.slug})
        )
        row = next(r for r in response.data if r["user"]["id"] == volunteer.pk)
        # Two visits in total, one of them last term — the count starts over.
        assert row["visits"] == 1

    def test_attendance_can_be_read_for_a_past_term(
        self, auth_client, lead, project, past_semester
    ):
        alumnus = UserFactory(email="alum@pilani.bits-pilani.ac.in")
        MembershipFactory(
            user=alumnus, project=project, semester=past_semester, role=Role.VOLUNTEER
        )
        attended(
            project,
            [alumnus],
            kind=LogKind.MOV,
            occurred_on=past_semester.ends_on - datetime.timedelta(days=2),
        )

        response = auth_client(lead).get(
            reverse("project-attendance", kwargs={"slug": project.slug}),
            {"semester": past_semester.slug},
        )
        row = next(r for r in response.data if r["user"]["id"] == alumnus.pk)
        assert row["visits"] == 1

    def test_a_past_terms_roster_is_the_one_that_is_counted(
        self, auth_client, lead, volunteer, project, past_semester
    ):
        """This term's members must not appear against last term's totals."""
        response = auth_client(lead).get(
            reverse("project-attendance", kwargs={"slug": project.slug}),
            {"semester": past_semester.slug},
        )
        assert [r["user"]["id"] for r in response.data] == []

    def test_an_unknown_semester_is_a_404(self, auth_client, lead, project):
        response = auth_client(lead).get(
            reverse("project-attendance", kwargs={"slug": project.slug}),
            {"semester": "no-such-term"},
        )
        assert response.status_code == 404


class TestArchive:
    def url(self, project):
        return reverse("project-archive", kwargs={"slug": project.slug})

    def test_lists_every_term_with_a_record(
        self, auth_client, lead, project, semester, past_semester
    ):
        MembershipFactory(user=UserFactory(), project=project, semester=past_semester)
        DailyLogFactory(project=project, kind=LogKind.MOV)
        archived_log(project, past_semester, kind=LogKind.MOM)

        response = auth_client(lead).get(self.url(project))
        assert response.status_code == 200
        slugs = [row["semester"]["slug"] for row in response.data]
        # Newest first, so the archive opens on the most recent term.
        assert slugs == [semester.slug, past_semester.slug]

    def test_counts_are_per_term(self, auth_client, lead, project, semester, past_semester):
        DailyLogFactory(project=project, kind=LogKind.MOV)
        DailyLogFactory(project=project, kind=LogKind.MOM)
        archived_log(project, past_semester, kind=LogKind.MOM)

        response = auth_client(lead).get(self.url(project))
        rows = {row["semester"]["slug"]: row for row in response.data}
        assert (rows[semester.slug]["visits"], rows[semester.slug]["meetings"]) == (1, 1)
        assert (rows[past_semester.slug]["visits"], rows[past_semester.slug]["meetings"]) == (0, 1)

    def test_drafts_and_removed_entries_are_not_counted(self, auth_client, lead, project, semester):
        DailyLogFactory(project=project, kind=LogKind.MOV, status=LogStatus.DRAFT)
        DailyLogFactory(project=project, kind=LogKind.MOV, is_deleted=True)
        DailyLogFactory(project=project, kind=LogKind.MOV)

        response = auth_client(lead).get(self.url(project))
        rows = {row["semester"]["slug"]: row for row in response.data}
        assert rows[semester.slug]["visits"] == 1

    def test_names_who_led_each_term(
        self, auth_client, lead, past_lead, project, semester, past_semester
    ):
        response = auth_client(lead).get(self.url(project))
        rows = {row["semester"]["slug"]: row for row in response.data}
        assert [u["email"] for u in rows[semester.slug]["leads"]] == [lead.email]
        assert [u["email"] for u in rows[past_semester.slug]["leads"]] == [past_lead.email]

    def test_a_past_member_can_read_the_archive(
        self, auth_client, past_lead, project, past_semester
    ):
        archived_log(project, past_semester)
        response = auth_client(past_lead).get(self.url(project))
        assert response.status_code == 200
        assert past_semester.slug in {row["semester"]["slug"] for row in response.data}

    def test_a_stranger_gets_a_404(self, auth_client, outsider, project):
        response = auth_client(outsider).get(self.url(project))
        assert response.status_code == 404
