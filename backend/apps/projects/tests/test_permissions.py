"""The role × action matrix.

Every later module leans on these rules, so this file is the regression net for
the whole API. The cases that matter most are the negative ones: a member of one
project must not reach another project's rows.
"""

import datetime

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.conftest import CAMPUS, MembershipFactory, UserFactory
from apps.projects.models import Membership, Role, Semester

pytestmark = pytest.mark.django_db


class TestProjectVisibility:
    def test_member_sees_only_their_own_projects(self, auth_client, volunteer, other_project):
        response = auth_client(volunteer).get(reverse("project-list"))
        assert response.status_code == 200
        slugs = {row["slug"] for row in response.data["results"]}
        assert slugs == {"education"}
        assert other_project.slug not in slugs

    def test_exec_sees_every_project_without_membership(
        self, auth_client, exec_user, project, other_project
    ):
        assert not Membership.objects.filter(user=exec_user).exists()
        response = auth_client(exec_user).get(reverse("project-list"))
        slugs = {row["slug"] for row in response.data["results"]}
        assert slugs == {project.slug, other_project.slug}

    def test_direct_hit_on_foreign_project_is_denied(self, auth_client, outsider, project):
        response = auth_client(outsider).get(
            reverse("project-detail", kwargs={"slug": project.slug})
        )
        assert response.status_code == 404

    def test_anonymous_is_rejected(self, api):
        assert api.get(reverse("project-list")).status_code == 401

    def test_my_role_is_reported_per_project(self, auth_client, lead, project):
        response = auth_client(lead).get(reverse("project-detail", kwargs={"slug": project.slug}))
        assert response.data["my_role"] == Role.LEAD

    def test_exec_role_is_reported_as_exec(self, auth_client, exec_user, project):
        response = auth_client(exec_user).get(
            reverse("project-detail", kwargs={"slug": project.slug})
        )
        assert response.data["my_role"] == "EXEC"


class TestProjectWrites:
    @pytest.mark.parametrize(
        ("actor", "expected"),
        [("exec_user", 201), ("lead", 403), ("finance_lead", 403), ("volunteer", 403)],
    )
    def test_only_exec_creates_projects(self, request, auth_client, actor, expected):
        user = request.getfixturevalue(actor)
        response = auth_client(user).post(
            reverse("project-list"), {"name": "Sanitation", "description": "New vertical."}
        )
        assert response.status_code == expected

    @pytest.mark.parametrize(
        ("actor", "expected"),
        [("exec_user", 200), ("lead", 200), ("finance_lead", 403), ("volunteer", 403)],
    )
    def test_lead_and_exec_can_edit_project_details(
        self, request, auth_client, project, actor, expected
    ):
        user = request.getfixturevalue(actor)
        response = auth_client(user).patch(
            reverse("project-detail", kwargs={"slug": project.slug}),
            {"description": "Updated."},
        )
        assert response.status_code == expected

    def test_lead_cannot_edit_a_project_they_do_not_lead(self, auth_client, outsider, project):
        response = auth_client(outsider).patch(
            reverse("project-detail", kwargs={"slug": project.slug}),
            {"description": "Not mine."},
        )
        # Filtered out of the queryset entirely, so it never reaches the
        # permission check.
        assert response.status_code == 404

    @pytest.mark.parametrize(("actor", "expected"), [("exec_user", 204), ("lead", 403)])
    def test_only_exec_deletes_projects(self, request, auth_client, project, actor, expected):
        user = request.getfixturevalue(actor)
        response = auth_client(user).delete(
            reverse("project-detail", kwargs={"slug": project.slug})
        )
        assert response.status_code == expected


class TestMembershipManagement:
    @pytest.mark.parametrize(
        ("actor", "expected"),
        [("exec_user", 201), ("lead", 201), ("finance_lead", 403), ("volunteer", 403)],
    )
    def test_who_can_add_members(self, request, auth_client, project, actor, expected):
        user = request.getfixturevalue(actor)
        response = auth_client(user).post(
            reverse("membership-list"),
            {
                "user_email": f"newbie@{CAMPUS}",
                "project": project.pk,
                "role": Role.VOLUNTEER,
            },
        )
        assert response.status_code == expected

    def test_lead_cannot_add_members_to_another_project(self, auth_client, lead, other_project):
        response = auth_client(lead).post(
            reverse("membership-list"),
            {
                "user_email": f"newbie@{CAMPUS}",
                "project": other_project.pk,
                "role": Role.VOLUNTEER,
            },
        )
        assert response.status_code == 403

    def test_non_campus_email_is_rejected(self, auth_client, lead, project):
        response = auth_client(lead).post(
            reverse("membership-list"),
            {
                "user_email": "someone@gmail.com",
                "project": project.pk,
                "role": Role.VOLUNTEER,
            },
        )
        assert response.status_code == 400
        assert "user_email" in response.data

    def test_goa_and_hyderabad_campuses_are_rejected(self, auth_client, lead, project):
        for domain in ("goa.bits-pilani.ac.in", "hyderabad.bits-pilani.ac.in"):
            response = auth_client(lead).post(
                reverse("membership-list"),
                {"user_email": f"x@{domain}", "project": project.pk, "role": Role.VOLUNTEER},
            )
            assert response.status_code == 400, domain

    def test_lookalike_domain_is_rejected(self, auth_client, lead, project):
        # A suffix check would wave this through.
        response = auth_client(lead).post(
            reverse("membership-list"),
            {
                "user_email": "attacker@evilpilani.bits-pilani.ac.in",
                "project": project.pk,
                "role": Role.VOLUNTEER,
            },
        )
        assert response.status_code == 400

    def test_roster_is_scoped_to_visible_projects(self, auth_client, volunteer, other_project):
        MembershipFactory(user=UserFactory(), project=other_project, role=Role.LEAD)
        response = auth_client(volunteer).get(reverse("membership-list"))
        assert response.status_code == 200
        project_ids = {row["project"] for row in response.data["results"]}
        assert other_project.pk not in project_ids

    def test_a_user_cannot_hold_two_roles_in_one_project_in_one_semester(self, project, semester):
        from django.db import IntegrityError

        user = UserFactory()
        MembershipFactory(user=user, project=project, semester=semester, role=Role.VOLUNTEER)
        with pytest.raises(IntegrityError):
            MembershipFactory(user=user, project=project, semester=semester, role=Role.LEAD)

    def test_the_same_user_may_hold_a_different_role_next_semester(
        self, project, semester, past_semester
    ):
        """Promotion is a new row, not an edit — last term's record stands."""
        user = UserFactory()
        MembershipFactory(user=user, project=project, semester=past_semester, role=Role.VOLUNTEER)
        MembershipFactory(user=user, project=project, semester=semester, role=Role.LEAD)

        assert Membership.objects.filter(user=user, project=project).count() == 2


class TestSemesterScopedRoles:
    """Roles expire with the term. The `past_lead` fixture is the whole point.

    Every test here would pass if writes resolved against unscoped membership,
    except that the user would get their old authority back — so each one
    asserts a *denial* that only per-semester resolution produces.
    """

    def test_a_past_member_still_sees_the_project(self, auth_client, past_lead, project):
        response = auth_client(past_lead).get(reverse("project-list"))
        assert response.status_code == 200
        assert {row["slug"] for row in response.data["results"]} == {project.slug}

    def test_a_past_member_can_open_the_project(self, auth_client, past_lead, project):
        response = auth_client(past_lead).get(
            reverse("project-detail", kwargs={"slug": project.slug})
        )
        assert response.status_code == 200

    def test_a_past_lead_reports_no_current_role(self, auth_client, past_lead, project):
        """Null `my_role` on a visible project is how the SPA spots archive-only access."""
        response = auth_client(past_lead).get(
            reverse("project-detail", kwargs={"slug": project.slug})
        )
        assert response.data["my_role"] is None

    def test_a_past_lead_cannot_edit_the_project(self, auth_client, past_lead, project):
        response = auth_client(past_lead).patch(
            reverse("project-detail", kwargs={"slug": project.slug}),
            {"description": "Still mine, surely."},
        )
        assert response.status_code == 403

    def test_a_past_lead_cannot_add_members(self, auth_client, past_lead, project):
        response = auth_client(past_lead).post(
            reverse("membership-list"),
            {"user_email": f"newbie@{CAMPUS}", "project": project.pk, "role": Role.VOLUNTEER},
        )
        assert response.status_code == 403

    def test_member_count_is_this_semester_only(
        self, auth_client, lead, past_lead, project, past_semester
    ):
        response = auth_client(lead).get(reverse("project-detail", kwargs={"slug": project.slug}))
        # `lead` is the only current member; `past_lead` sits in the closed term.
        assert response.data["member_count"] == 1

    def test_roster_defaults_to_the_current_semester(self, auth_client, lead, past_lead, project):
        response = auth_client(lead).get(reverse("membership-list"), {"project": project.slug})
        emails = {row["user"]["email"] for row in response.data["results"]}
        assert emails == {lead.email}

    def test_roster_can_be_read_for_a_past_semester(
        self, auth_client, lead, past_lead, project, past_semester
    ):
        response = auth_client(lead).get(
            reverse("membership-list"), {"project": project.slug, "semester": past_semester.slug}
        )
        emails = {row["user"]["email"] for row in response.data["results"]}
        assert emails == {past_lead.email}

    def test_lead_cannot_rewrite_a_past_roster(
        self, auth_client, lead, past_lead, project, past_semester
    ):
        stale = Membership.objects.get(user=past_lead, semester=past_semester)
        response = auth_client(lead).patch(
            reverse("membership-detail", kwargs={"pk": stale.pk}), {"role": Role.VOLUNTEER}
        )
        assert response.status_code == 403

    def test_exec_can_correct_a_past_roster(
        self, auth_client, exec_user, past_lead, project, past_semester
    ):
        """The backfilled terms are a guess, so exec keeps a way to fix them."""
        stale = Membership.objects.get(user=past_lead, semester=past_semester)
        response = auth_client(exec_user).patch(
            reverse("membership-detail", kwargs={"pk": stale.pk}), {"role": Role.VOLUNTEER}
        )
        assert response.status_code == 200


class TestSemesterManagement:
    def _payload(self, semester, **overrides):
        start = semester.ends_on + datetime.timedelta(days=1)
        payload = {
            "name": "Next Term",
            "starts_on": start.isoformat(),
            "ends_on": (start + datetime.timedelta(days=120)).isoformat(),
        }
        payload.update(overrides)
        return payload

    @pytest.mark.parametrize(
        ("actor", "expected"),
        [("exec_user", 201), ("lead", 403), ("finance_lead", 403), ("volunteer", 403)],
    )
    def test_only_exec_opens_a_semester(self, request, auth_client, semester, actor, expected):
        user = request.getfixturevalue(actor)
        response = auth_client(user).post(reverse("semester-list"), self._payload(semester))
        assert response.status_code == expected

    def test_any_member_can_list_semesters(self, auth_client, volunteer, semester):
        response = auth_client(volunteer).get(reverse("semester-list"))
        assert response.status_code == 200
        assert semester.slug in {row["slug"] for row in response.data["results"]}

    def test_overlapping_terms_are_rejected(self, auth_client, exec_user, semester):
        response = auth_client(exec_user).post(
            reverse("semester-list"),
            self._payload(
                semester,
                name="Overlaps",
                starts_on=semester.starts_on.isoformat(),
                ends_on=semester.ends_on.isoformat(),
            ),
        )
        assert response.status_code == 400

    def test_a_term_must_end_after_it_starts(self, auth_client, exec_user, semester):
        start = semester.ends_on + datetime.timedelta(days=10)
        response = auth_client(exec_user).post(
            reverse("semester-list"),
            {
                "name": "Backwards",
                "starts_on": start.isoformat(),
                "ends_on": (start - datetime.timedelta(days=1)).isoformat(),
            },
        )
        assert response.status_code == 400

    def test_opening_a_term_carries_the_roster_forward(
        self, auth_client, exec_user, lead, finance_lead, volunteer, project, semester
    ):
        """Otherwise every project starts the term empty and nobody can write."""
        response = auth_client(exec_user).post(reverse("semester-list"), self._payload(semester))
        assert response.status_code == 201

        opened = Semester.objects.get(slug=response.data["slug"])
        carried = Membership.objects.filter(semester=opened, project=project)
        assert {m.user.email for m in carried} == {
            lead.email,
            finance_lead.email,
            volunteer.email,
        }
        # Roles come across intact — a lead does not restart as a volunteer.
        assert carried.get(user=lead).role == Role.LEAD

    def test_carrying_forward_skips_people_already_placed(
        self, auth_client, exec_user, lead, project, semester
    ):
        """Re-running must not clobber a role the lead has already corrected."""
        from apps.projects.services import carry_forward_roster

        opened = Semester.objects.create(
            name="Hand-built Term",
            starts_on=semester.ends_on + datetime.timedelta(days=1),
            ends_on=semester.ends_on + datetime.timedelta(days=100),
        )
        MembershipFactory(user=lead, project=project, semester=opened, role=Role.VOLUNTEER)

        carry_forward_roster(opened)

        assert Membership.objects.get(user=lead, semester=opened).role == Role.VOLUNTEER

    def test_current_endpoint_reports_the_open_term(self, auth_client, volunteer, semester):
        response = auth_client(volunteer).get(reverse("semester-current"))
        assert response.status_code == 200
        assert response.data["slug"] == semester.slug
        assert response.data["is_current"] is True


class TestSemesterModel:
    def test_for_date_finds_the_containing_term(self, semester):
        assert Semester.for_date(timezone.localdate()) == semester

    def test_a_date_in_a_gap_falls_to_the_last_finished_term(self, semester, past_semester):
        """Summer work belongs to the term that was last running, not to nothing."""
        gap_day = past_semester.ends_on + datetime.timedelta(days=1)
        # Sits between the two terms only if `semester` starts later than that.
        if gap_day < semester.starts_on:
            assert Semester.for_date(gap_day) == past_semester

    def test_a_date_before_every_term_has_none(self, past_semester):
        assert Semester.for_date(past_semester.starts_on - datetime.timedelta(days=1)) is None


class TestCrossProjectRoles:
    def test_roles_are_independent_per_project(self, auth_client, project, other_project):
        """The central premise: lead here, volunteer there."""
        user = UserFactory(email=f"dual@{CAMPUS}")
        MembershipFactory(user=user, project=project, role=Role.LEAD)
        MembershipFactory(user=user, project=other_project, role=Role.VOLUNTEER)

        client = auth_client(user)

        assert (
            client.patch(
                reverse("project-detail", kwargs={"slug": project.slug}),
                {"description": "As lead."},
            ).status_code
            == 200
        )
        assert (
            client.patch(
                reverse("project-detail", kwargs={"slug": other_project.slug}),
                {"description": "As volunteer."},
            ).status_code
            == 403
        )
