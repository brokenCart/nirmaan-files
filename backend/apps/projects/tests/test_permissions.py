"""The role × action matrix.

Every later module leans on these rules, so this file is the regression net for
the whole API. The cases that matter most are the negative ones: a member of one
project must not reach another project's rows.
"""

import datetime

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import User
from apps.conftest import CAMPUS, DailyLogFactory, MembershipFactory, UserFactory
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

    @pytest.mark.parametrize(
        ("role", "expected"),
        [(Role.VOLUNTEER, 201), (Role.FINANCE_LEAD, 403), (Role.LEAD, 403)],
    )
    def test_lead_can_only_hand_out_the_volunteer_role(
        self, auth_client, lead, project, role, expected
    ):
        """Appointing staff is exec's call — a lead naming their own successor
        or a second lead would put nobody above them in the loop."""
        response = auth_client(lead).post(
            reverse("membership-list"),
            {"user_email": f"newbie@{CAMPUS}", "project": project.pk, "role": role},
        )
        assert response.status_code == expected

    @pytest.mark.parametrize("role", [Role.FINANCE_LEAD, Role.LEAD])
    def test_exec_can_hand_out_any_role(self, auth_client, exec_user, project, role):
        response = auth_client(exec_user).post(
            reverse("membership-list"),
            {"user_email": f"newbie@{CAMPUS}", "project": project.pk, "role": role},
        )
        assert response.status_code == 201

    def test_omitted_role_defaults_to_volunteer_for_a_lead(self, auth_client, lead, project):
        """The model default is VOLUNTEER, so leaving `role` out must not skip
        the check — it has to resolve to the default and pass on its own terms."""
        response = auth_client(lead).post(
            reverse("membership-list"),
            {"user_email": f"newbie@{CAMPUS}", "project": project.pk},
        )
        assert response.status_code == 201
        assert Membership.objects.get(user__email=f"newbie@{CAMPUS}").role == Role.VOLUNTEER

    def test_lead_cannot_promote_a_volunteer_they_added(
        self, auth_client, lead, volunteer, project, semester
    ):
        """Otherwise the rule is one PATCH away from moot: add as a volunteer,
        then promote."""
        row = Membership.objects.get(user=volunteer, project=project, semester=semester)
        response = auth_client(lead).patch(
            reverse("membership-detail", kwargs={"pk": row.pk}), {"role": Role.LEAD}
        )
        assert response.status_code == 403
        row.refresh_from_db()
        assert row.role == Role.VOLUNTEER

    def test_lead_cannot_demote_a_finance_lead(
        self, auth_client, lead, finance_lead, project, semester
    ):
        """The same authority in the other direction — removing staff is exec's
        too, or a lead could clear the seat beside them."""
        row = Membership.objects.get(user=finance_lead, project=project, semester=semester)
        response = auth_client(lead).patch(
            reverse("membership-detail", kwargs={"pk": row.pk}), {"role": Role.VOLUNTEER}
        )
        assert response.status_code == 403

    def test_lead_cannot_remove_a_finance_lead_from_the_roster(
        self, auth_client, lead, finance_lead, project, semester
    ):
        row = Membership.objects.get(user=finance_lead, project=project, semester=semester)
        response = auth_client(lead).delete(reverse("membership-detail", kwargs={"pk": row.pk}))
        assert response.status_code == 403

    @pytest.mark.parametrize("staff", ["lead", "finance_lead"])
    def test_lead_cannot_remove_other_staff(
        self, request, auth_client, lead, project, semester, staff
    ):
        """A lead removes volunteers. Clearing the seat beside them — the other
        lead, or the finance lead — is the same authority as appointing one."""
        other = request.getfixturevalue(staff)
        row = Membership.objects.get(user=other, project=project, semester=semester)
        response = auth_client(lead).delete(reverse("membership-detail", kwargs={"pk": row.pk}))
        assert response.status_code == 403
        assert Membership.objects.filter(pk=row.pk).exists()

    @pytest.mark.parametrize("staff", ["lead", "finance_lead"])
    def test_lead_cannot_deactivate_other_staff(
        self, request, auth_client, lead, project, semester, staff
    ):
        """`is_active=False` is a removal in disguise — it drops the row from
        the roster, the attendance table and the project's member count alike,
        so it has to answer to the same rule as DELETE."""
        other = request.getfixturevalue(staff)
        row = Membership.objects.get(user=other, project=project, semester=semester)
        response = auth_client(lead).patch(
            reverse("membership-detail", kwargs={"pk": row.pk}), {"is_active": False}
        )
        assert response.status_code == 403
        row.refresh_from_db()
        assert row.is_active is True

    def test_lead_can_deactivate_a_volunteer(self, auth_client, lead, volunteer, project, semester):
        row = Membership.objects.get(user=volunteer, project=project, semester=semester)
        response = auth_client(lead).patch(
            reverse("membership-detail", kwargs={"pk": row.pk}), {"is_active": False}
        )
        assert response.status_code == 200

    def test_exec_cannot_remove_their_own_row(self, auth_client, exec_user, project, semester):
        """The case the rule actually adds. Exec bypasses the role and term
        checks, so nothing else was stopping them clearing their own row and
        losing the project's write affordances mid-term."""
        row = MembershipFactory(
            user=exec_user, project=project, semester=semester, role=Role.VOLUNTEER
        )
        response = auth_client(exec_user).delete(
            reverse("membership-detail", kwargs={"pk": row.pk})
        )
        assert response.status_code == 403
        assert Membership.objects.filter(pk=row.pk).exists()

    def test_exec_cannot_deactivate_their_own_row(self, auth_client, exec_user, project, semester):
        """The `is_active` back door out of the same rule."""
        row = MembershipFactory(
            user=exec_user, project=project, semester=semester, role=Role.VOLUNTEER
        )
        response = auth_client(exec_user).patch(
            reverse("membership-detail", kwargs={"pk": row.pk}), {"is_active": False}
        )
        assert response.status_code == 403
        row.refresh_from_db()
        assert row.is_active is True

    def test_lead_cannot_remove_their_own_row(self, auth_client, lead, project, semester):
        """Belt and braces: a lead's own row is a LEAD row, so the staff rule
        already refuses this. Pinned anyway, because the day a lead is allowed
        to hold some other role that reasoning stops holding."""
        row = Membership.objects.get(user=lead, project=project, semester=semester)
        response = auth_client(lead).delete(reverse("membership-detail", kwargs={"pk": row.pk}))
        assert response.status_code == 403
        assert Membership.objects.filter(pk=row.pk).exists()

    def test_someone_else_can_still_remove_you(
        self, auth_client, exec_user, volunteer, project, semester
    ):
        """The rule is about acting on your own row, not about the row itself."""
        row = Membership.objects.get(user=volunteer, project=project, semester=semester)
        response = auth_client(exec_user).delete(
            reverse("membership-detail", kwargs={"pk": row.pk})
        )
        assert response.status_code == 204

    def test_editing_your_own_row_without_deactivating_is_unaffected(
        self, auth_client, exec_user, project, semester
    ):
        """Only removal is blocked — an exec correcting their own role is not
        leaving the project."""
        row = MembershipFactory(
            user=exec_user, project=project, semester=semester, role=Role.VOLUNTEER
        )
        response = auth_client(exec_user).patch(
            reverse("membership-detail", kwargs={"pk": row.pk}), {"role": Role.LEAD}
        )
        assert response.status_code == 200

    def test_lead_can_still_remove_a_volunteer(
        self, auth_client, lead, volunteer, project, semester
    ):
        row = Membership.objects.get(user=volunteer, project=project, semester=semester)
        response = auth_client(lead).delete(reverse("membership-detail", kwargs={"pk": row.pk}))
        assert response.status_code == 204

    def test_removing_an_unclaimed_placeholder_deletes_the_user(
        self, auth_client, lead, project, semester
    ):
        """A lead added a typo. Taking it off the roster takes the row with it,
        or the account sits there forever with nobody able to claim it."""
        placeholder = UserFactory(email=f"typo@{CAMPUS}", google_sub=None)
        row = MembershipFactory(
            user=placeholder, project=project, semester=semester, role=Role.VOLUNTEER
        )

        response = auth_client(lead).delete(reverse("membership-detail", kwargs={"pk": row.pk}))

        assert response.status_code == 204
        assert not User.objects.filter(pk=placeholder.pk).exists()

    def test_removing_a_signed_in_member_keeps_the_user(self, auth_client, lead, project, semester):
        """They have an account of their own — it is not this project's to delete."""
        member = UserFactory(email=f"real@{CAMPUS}", google_sub="google-real")
        row = MembershipFactory(
            user=member, project=project, semester=semester, role=Role.VOLUNTEER
        )

        response = auth_client(lead).delete(reverse("membership-detail", kwargs={"pk": row.pk}))

        assert response.status_code == 204
        assert User.objects.filter(pk=member.pk).exists()
        assert not Membership.objects.filter(pk=row.pk).exists()

    def test_placeholder_on_another_project_survives_removal(
        self, auth_client, lead, project, other_project, semester
    ):
        """`Membership.user` cascades, so deleting the row here would silently
        empty a seat on a project this lead has no authority over."""
        placeholder = UserFactory(email=f"shared@{CAMPUS}", google_sub=None)
        here = MembershipFactory(
            user=placeholder, project=project, semester=semester, role=Role.VOLUNTEER
        )
        elsewhere = MembershipFactory(
            user=placeholder, project=other_project, semester=semester, role=Role.VOLUNTEER
        )

        response = auth_client(lead).delete(reverse("membership-detail", kwargs={"pk": here.pk}))

        assert response.status_code == 204
        assert User.objects.filter(pk=placeholder.pk).exists()
        assert Membership.objects.filter(pk=elsewhere.pk).exists()

    def test_placeholder_in_a_past_term_survives_removal(
        self, auth_client, lead, project, semester, past_semester
    ):
        """The archive's roster is the record of who was there."""
        placeholder = UserFactory(email=f"returning@{CAMPUS}", google_sub=None)
        MembershipFactory(
            user=placeholder, project=project, semester=past_semester, role=Role.VOLUNTEER
        )
        row = MembershipFactory(
            user=placeholder, project=project, semester=semester, role=Role.VOLUNTEER
        )

        response = auth_client(lead).delete(reverse("membership-detail", kwargs={"pk": row.pk}))

        assert response.status_code == 204
        assert User.objects.filter(pk=placeholder.pk).exists()

    def test_placeholder_marked_present_on_a_visit_survives_removal(
        self, auth_client, lead, project, semester
    ):
        """`attendees` is a plain M2M and would drop silently, restating who was
        at a visit and moving the counts. Marking a placeholder present before
        they sign in is exactly why a lead adds them early."""
        placeholder = UserFactory(email=f"attended@{CAMPUS}", google_sub=None)
        row = MembershipFactory(
            user=placeholder, project=project, semester=semester, role=Role.VOLUNTEER
        )
        log = DailyLogFactory(project=project, semester=semester, author=lead)
        log.attendees.add(placeholder)

        response = auth_client(lead).delete(reverse("membership-detail", kwargs={"pk": row.pk}))

        assert response.status_code == 204
        assert User.objects.filter(pk=placeholder.pk).exists()
        assert log.attendees.filter(pk=placeholder.pk).exists()

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
        self, auth_client, lead, volunteer, past_lead, project, past_semester
    ):
        response = auth_client(lead).get(reverse("project-detail", kwargs={"slug": project.slug}))
        # `lead` and `volunteer` are this term's roster; `past_lead` sits in the
        # closed term and must not be counted. Two current members rather than
        # one on purpose: a count of the caller's own rows would also come to 1.
        assert response.data["member_count"] == 2

    def test_member_count_is_the_whole_roster_not_the_caller_s_own_rows(
        self, auth_client, lead, finance_lead, volunteer, exec_user, project
    ):
        """Annotating a count over the join `visible_projects` filters counts one row.

        Exec's queryset joins `memberships` for nobody, so exec saw the true
        number while every member saw their own membership back as the roster
        size. Both must agree.
        """
        url = reverse("project-detail", kwargs={"slug": project.slug})
        counts = {
            who.email: auth_client(who).get(url).data["member_count"]
            for who in (lead, finance_lead, volunteer, exec_user)
        }
        assert set(counts.values()) == {3}

    def test_a_past_member_sees_the_current_roster_size(
        self, auth_client, lead, volunteer, past_lead, project, past_semester
    ):
        """Archive-only access still reports this term's count, not zero."""
        response = auth_client(past_lead).get(
            reverse("project-detail", kwargs={"slug": project.slug})
        )
        assert response.data["member_count"] == 2

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

    def test_lead_cannot_add_to_a_past_semester(self, auth_client, lead, project, past_semester):
        """`semester` is sent explicitly by the roster UI, so it is a real write path.

        Without this the frozen-archive rule would be one form field away from
        moot: a lead who cannot patch last term's roster could still post a new
        row into it.
        """
        response = auth_client(lead).post(
            reverse("membership-list"),
            {
                "user_email": f"newbie@{CAMPUS}",
                "project": project.pk,
                "semester": past_semester.pk,
                "role": Role.VOLUNTEER,
            },
        )
        assert response.status_code == 403
        assert not Membership.objects.filter(semester=past_semester, role=Role.VOLUNTEER).exists()

    def test_exec_can_add_to_a_past_semester(self, auth_client, exec_user, project, past_semester):
        response = auth_client(exec_user).post(
            reverse("membership-list"),
            {
                "user_email": f"newbie@{CAMPUS}",
                "project": project.pk,
                "semester": past_semester.pk,
                "role": Role.VOLUNTEER,
            },
        )
        assert response.status_code == 201
        assert Membership.objects.get(user__email=f"newbie@{CAMPUS}").semester == past_semester

    def test_explicit_current_semester_is_accepted_from_a_lead(
        self, auth_client, lead, project, semester
    ):
        """The UI names the term rather than relying on the serializer default."""
        response = auth_client(lead).post(
            reverse("membership-list"),
            {
                "user_email": f"newbie@{CAMPUS}",
                "project": project.pk,
                "semester": semester.pk,
                "role": Role.VOLUNTEER,
            },
        )
        assert response.status_code == 201
        assert Membership.objects.get(user__email=f"newbie@{CAMPUS}").semester == semester


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
