"""The role × action matrix.

Every later module leans on these rules, so this file is the regression net for
the whole API. The cases that matter most are the negative ones: a member of one
project must not reach another project's rows.
"""

import pytest
from django.urls import reverse

from apps.conftest import CAMPUS, MembershipFactory, UserFactory
from apps.projects.models import Membership, Role

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

    def test_a_user_cannot_hold_two_roles_in_one_project(self, project):
        from django.db import IntegrityError

        user = UserFactory()
        MembershipFactory(user=user, project=project, role=Role.VOLUNTEER)
        with pytest.raises(IntegrityError):
            MembershipFactory(user=user, project=project, role=Role.LEAD)


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
