"""The resource shelf: reading, writing, and the rules that differ from a log's."""

import pytest
from django.urls import reverse

from apps.conftest import MembershipFactory, ResourceFactory, UserFactory
from apps.projects.models import Role
from apps.resources.models import Resource, ResourceKind

pytestmark = pytest.mark.django_db


def resource_payload(project, **overrides):
    payload = {
        "project": project.pk,
        "kind": ResourceKind.FOLDER,
        "title": "Project Drive folder",
        "url": "https://drive.google.com/drive/folders/abc123",
        "description": "Photos, reports and the term plan.",
    }
    payload.update(overrides)
    return payload


class TestResourceVisibility:
    def test_resources_are_scoped_to_the_users_projects(
        self, auth_client, volunteer, project, other_project
    ):
        ResourceFactory(project=project, title="Mine")
        ResourceFactory(project=other_project, title="Not mine")

        response = auth_client(volunteer).get(reverse("resource-list"))
        assert {row["title"] for row in response.data} == {"Mine"}

    def test_exec_sees_every_projects_resources(
        self, auth_client, exec_user, project, other_project
    ):
        ResourceFactory(project=project, title="A")
        ResourceFactory(project=other_project, title="B")
        response = auth_client(exec_user).get(reverse("resource-list"))
        assert {row["title"] for row in response.data} == {"A", "B"}

    def test_filtering_by_project_slug(self, auth_client, exec_user, project, other_project):
        ResourceFactory(project=project, title="Mine")
        ResourceFactory(project=other_project, title="Theirs")
        response = auth_client(exec_user).get(reverse("resource-list"), {"project": project.slug})
        assert [row["title"] for row in response.data] == ["Mine"]

    def test_filtering_by_kind(self, auth_client, volunteer, project):
        ResourceFactory(project=project, title="Folder", kind=ResourceKind.FOLDER)
        ResourceFactory(project=project, title="Form", kind=ResourceKind.FORM)
        response = auth_client(volunteer).get(reverse("resource-list"), {"kind": ResourceKind.FORM})
        assert [row["title"] for row in response.data] == ["Form"]

    def test_a_foreign_resource_cannot_be_opened_directly(self, auth_client, outsider, project):
        resource = ResourceFactory(project=project)
        response = auth_client(outsider).get(reverse("resource-detail", kwargs={"pk": resource.pk}))
        # Filtered out of the queryset, so it 404s rather than confirming it
        # exists — the same answer a foreign project gives.
        assert response.status_code == 404

    def test_anonymous_is_rejected(self, api):
        assert api.get(reverse("resource-list")).status_code == 401


class TestResourceWrites:
    @pytest.mark.parametrize(
        ("actor", "expected"),
        [("exec_user", 201), ("lead", 201), ("finance_lead", 201), ("volunteer", 201)],
    )
    def test_any_current_member_can_add_a_link(
        self, request, auth_client, project, actor, expected
    ):
        user = request.getfixturevalue(actor)
        response = auth_client(user).post(reverse("resource-list"), resource_payload(project))
        assert response.status_code == expected

    def test_the_adder_is_recorded(self, auth_client, volunteer, project):
        response = auth_client(volunteer).post(reverse("resource-list"), resource_payload(project))
        assert response.data["added_by"]["id"] == volunteer.pk

    def test_added_by_cannot_be_spoofed(self, auth_client, volunteer, lead, project):
        response = auth_client(volunteer).post(
            reverse("resource-list"), resource_payload(project, added_by=lead.pk)
        )
        assert response.data["added_by"]["id"] == volunteer.pk

    def test_an_outsider_cannot_add_to_another_project(self, auth_client, outsider, project):
        response = auth_client(outsider).post(reverse("resource-list"), resource_payload(project))
        assert response.status_code == 403
        assert not Resource.objects.filter(project=project).exists()

    def test_the_same_link_cannot_be_added_twice(self, auth_client, lead, project):
        client = auth_client(lead)
        assert client.post(reverse("resource-list"), resource_payload(project)).status_code == 201
        second = client.post(reverse("resource-list"), resource_payload(project, title="Again"))
        assert second.status_code == 400

    def test_the_same_link_may_sit_on_two_projects(
        self, auth_client, exec_user, project, other_project
    ):
        client = auth_client(exec_user)
        assert client.post(reverse("resource-list"), resource_payload(project)).status_code == 201
        assert (
            client.post(reverse("resource-list"), resource_payload(other_project)).status_code
            == 201
        )

    @pytest.mark.parametrize(
        "url",
        [
            "javascript:alert(1)",
            "ftp://files.example.com/plan.pdf",
            "drive.google.com/folders/abc",
            "not a url at all",
        ],
    )
    def test_non_web_links_are_rejected(self, auth_client, lead, project, url):
        response = auth_client(lead).post(
            reverse("resource-list"), resource_payload(project, url=url)
        )
        assert response.status_code == 400
        assert "url" in response.data

    def test_a_blank_title_is_rejected(self, auth_client, lead, project):
        response = auth_client(lead).post(
            reverse("resource-list"), resource_payload(project, title="   ")
        )
        assert response.status_code == 400
        assert "title" in response.data

    def test_titles_are_trimmed(self, auth_client, lead, project):
        response = auth_client(lead).post(
            reverse("resource-list"), resource_payload(project, title="  Term plan  ")
        )
        assert response.data["title"] == "Term plan"


class TestResourceEditing:
    """Wider than a log's: whoever added it, or whoever runs the project."""

    def test_the_adder_can_edit_their_own_link(self, auth_client, volunteer, project):
        resource = ResourceFactory(project=project, added_by=volunteer)
        response = auth_client(volunteer).patch(
            reverse("resource-detail", kwargs={"pk": resource.pk}), {"title": "Renamed"}
        )
        assert response.status_code == 200
        assert response.data["title"] == "Renamed"

    @pytest.mark.parametrize(
        ("actor", "expected"),
        [("exec_user", 200), ("lead", 200), ("finance_lead", 200), ("volunteer", 403)],
    )
    def test_who_can_fix_someone_elses_link(self, request, auth_client, project, actor, expected):
        # Added by a member who is nobody in the parametrised list, so each
        # actor is judged on their role rather than on having added it.
        author = UserFactory(email="paster@pilani.bits-pilani.ac.in")
        MembershipFactory(user=author, project=project, role=Role.VOLUNTEER)
        resource = ResourceFactory(project=project, added_by=author)

        user = request.getfixturevalue(actor)
        response = auth_client(user).patch(
            reverse("resource-detail", kwargs={"pk": resource.pk}),
            {"url": "https://drive.google.com/drive/folders/moved"},
        )
        assert response.status_code == expected

    @pytest.mark.parametrize(
        ("actor", "expected"),
        [("exec_user", 204), ("lead", 204), ("finance_lead", 204), ("volunteer", 403)],
    )
    def test_who_can_remove_someone_elses_link(
        self, request, auth_client, project, actor, expected
    ):
        author = UserFactory(email="paster@pilani.bits-pilani.ac.in")
        MembershipFactory(user=author, project=project, role=Role.VOLUNTEER)
        resource = ResourceFactory(project=project, added_by=author)

        user = request.getfixturevalue(actor)
        response = auth_client(user).delete(reverse("resource-detail", kwargs={"pk": resource.pk}))
        assert response.status_code == expected

    def test_a_volunteer_can_withdraw_their_own_link(self, auth_client, volunteer, project):
        resource = ResourceFactory(project=project, added_by=volunteer)
        response = auth_client(volunteer).delete(
            reverse("resource-detail", kwargs={"pk": resource.pk})
        )
        assert response.status_code == 204
        # Hard, unlike a log's soft delete: a pointer is not a published account.
        assert not Resource.objects.filter(pk=resource.pk).exists()

    def test_a_resource_cannot_be_moved_to_another_project(
        self, auth_client, exec_user, project, other_project
    ):
        resource = ResourceFactory(project=project)
        response = auth_client(exec_user).patch(
            reverse("resource-detail", kwargs={"pk": resource.pk}),
            {"project": other_project.pk},
        )
        assert response.status_code == 400
        assert "project" in response.data

    def test_an_outsider_cannot_edit(self, auth_client, outsider, project):
        resource = ResourceFactory(project=project)
        response = auth_client(outsider).patch(
            reverse("resource-detail", kwargs={"pk": resource.pk}), {"title": "Mine now"}
        )
        assert response.status_code == 404
