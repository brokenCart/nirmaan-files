"""The knowledge base: who reads it, who writes it, and what the history keeps.

The rule this file exists to hold down is the open edit: **any current member
may edit any page**, which is wider than every other write rule in the codebase
and is safe only because every version survives. Most of what follows is either
that rule or the revision trail that pays for it.
"""

import pytest
from django.urls import reverse

from apps.conftest import ArticleFactory, MembershipFactory, UserFactory
from apps.knowledge.models import Article, ArticleCategory, ArticleRevision
from apps.projects.models import Role

pytestmark = pytest.mark.django_db


def article_payload(project, **overrides):
    payload = {
        "project": project.pk,
        "category": ArticleCategory.PROCESS,
        "title": "How the Saturday visit runs",
        "body": "The bus leaves the main gate at 08:00. Ask for Sunita at the school office.",
    }
    payload.update(overrides)
    return payload


def revisions_url(article):
    return reverse("article-revisions", kwargs={"pk": article.pk})


class TestArticleVisibility:
    def test_articles_are_scoped_to_the_users_projects(
        self, auth_client, volunteer, project, other_project
    ):
        ArticleFactory(project=project, title="Mine")
        ArticleFactory(project=other_project, title="Not mine")

        response = auth_client(volunteer).get(reverse("article-list"))
        assert {row["title"] for row in response.data} == {"Mine"}

    def test_exec_sees_every_projects_articles(
        self, auth_client, exec_user, project, other_project
    ):
        ArticleFactory(project=project, title="A")
        ArticleFactory(project=other_project, title="B")
        response = auth_client(exec_user).get(reverse("article-list"))
        assert {row["title"] for row in response.data} == {"A", "B"}

    def test_a_past_member_still_reads_the_knowledge_base(self, auth_client, past_lead, project):
        """The whole point of the module: the roster turns over, the knowledge does not."""
        ArticleFactory(project=project, title="Partner contacts")
        response = auth_client(past_lead).get(reverse("article-list"))
        assert [row["title"] for row in response.data] == ["Partner contacts"]

    def test_soft_deleted_pages_are_hidden(self, auth_client, volunteer, project):
        ArticleFactory(project=project, title="Live")
        ArticleFactory(project=project, title="Removed", is_deleted=True)
        response = auth_client(volunteer).get(reverse("article-list"))
        assert [row["title"] for row in response.data] == ["Live"]

    def test_filtering_by_project_slug(self, auth_client, exec_user, project, other_project):
        ArticleFactory(project=project, title="Mine")
        ArticleFactory(project=other_project, title="Theirs")
        response = auth_client(exec_user).get(reverse("article-list"), {"project": project.slug})
        assert [row["title"] for row in response.data] == ["Mine"]

    def test_filtering_by_category(self, auth_client, volunteer, project):
        ArticleFactory(project=project, title="Lore", category=ArticleCategory.CONTEXT)
        ArticleFactory(project=project, title="Runbook", category=ArticleCategory.PROCESS)
        response = auth_client(volunteer).get(
            reverse("article-list"), {"category": ArticleCategory.PROCESS}
        )
        assert [row["title"] for row in response.data] == ["Runbook"]

    def test_search_matches_the_body_as_well_as_the_title(self, auth_client, volunteer, project):
        ArticleFactory(project=project, title="Transport", body="The bus leaves at eight.")
        ArticleFactory(project=project, title="Bus routes", body="Nothing relevant here.")
        ArticleFactory(project=project, title="Syllabus", body="Also unrelated.")

        response = auth_client(volunteer).get(reverse("article-list"), {"q": "bus"})
        # "Transport" on its body, "Bus routes" on its title. "Syllabus" contains
        # the letters but ILIKE is a substring match, so it comes back too —
        # asserted rather than wished away, since that is what the endpoint does.
        assert {row["title"] for row in response.data} == {"Transport", "Bus routes", "Syllabus"}

    def test_the_index_carries_an_excerpt_not_the_body(self, auth_client, volunteer, project):
        ArticleFactory(project=project, body="x " * 400)
        row = auth_client(volunteer).get(reverse("article-list")).data[0]
        assert "body" not in row
        assert row["excerpt"].endswith("…")

    def test_the_detail_route_carries_the_whole_body(self, auth_client, volunteer, project):
        article = ArticleFactory(project=project, body="Every word of it.")
        response = auth_client(volunteer).get(reverse("article-detail", kwargs={"pk": article.pk}))
        assert response.data["body"] == "Every word of it."

    def test_a_foreign_article_cannot_be_opened_directly(self, auth_client, outsider, project):
        article = ArticleFactory(project=project)
        response = auth_client(outsider).get(reverse("article-detail", kwargs={"pk": article.pk}))
        # Filtered out of the queryset, so it 404s rather than confirming it
        # exists — the same answer a foreign project gives.
        assert response.status_code == 404

    def test_anonymous_is_rejected(self, api):
        assert api.get(reverse("article-list")).status_code == 401


class TestArticleCreation:
    @pytest.mark.parametrize(
        ("actor", "expected"),
        [("exec_user", 201), ("lead", 201), ("finance_lead", 201), ("volunteer", 201)],
    )
    def test_any_current_member_can_start_a_page(
        self, request, auth_client, project, actor, expected
    ):
        user = request.getfixturevalue(actor)
        response = auth_client(user).post(reverse("article-list"), article_payload(project))
        assert response.status_code == expected

    def test_the_author_is_recorded_on_both_sides(self, auth_client, volunteer, project):
        response = auth_client(volunteer).post(reverse("article-list"), article_payload(project))
        assert response.data["created_by"]["id"] == volunteer.pk
        # A brand new page reads as last edited by whoever wrote it.
        assert response.data["updated_by"]["id"] == volunteer.pk

    def test_authorship_cannot_be_spoofed(self, auth_client, volunteer, lead, project):
        response = auth_client(volunteer).post(
            reverse("article-list"),
            article_payload(project, created_by=lead.pk, updated_by=lead.pk),
        )
        assert response.data["created_by"]["id"] == volunteer.pk
        assert response.data["updated_by"]["id"] == volunteer.pk

    def test_creating_records_the_first_revision(self, auth_client, volunteer, project):
        response = auth_client(volunteer).post(
            reverse("article-list"), article_payload(project, revision_note="Wrote it up")
        )
        article = Article.objects.get(pk=response.data["id"])
        revision = article.revisions.get()
        assert (revision.title, revision.edited_by, revision.note) == (
            "How the Saturday visit runs",
            volunteer,
            "Wrote it up",
        )
        # A page exists at version one, never at version zero.
        assert response.data["revision_count"] == 1

    def test_an_outsider_cannot_start_a_page(self, auth_client, outsider, project):
        response = auth_client(outsider).post(reverse("article-list"), article_payload(project))
        assert response.status_code == 403
        assert not Article.objects.filter(project=project).exists()

    def test_a_past_lead_cannot_start_a_page(self, auth_client, past_lead, project):
        """Reads the whole knowledge base, writes none of it."""
        response = auth_client(past_lead).post(reverse("article-list"), article_payload(project))
        assert response.status_code == 403

    def test_two_live_pages_cannot_share_a_title(self, auth_client, lead, project):
        client = auth_client(lead)
        assert client.post(reverse("article-list"), article_payload(project)).status_code == 201
        second = client.post(reverse("article-list"), article_payload(project, body="Different."))
        assert second.status_code == 400
        assert "title" in second.data

    def test_removing_a_page_frees_its_title(self, auth_client, lead, project):
        """The uniqueness constraint is partial, so a tombstone does not squat."""
        client = auth_client(lead)
        created = client.post(reverse("article-list"), article_payload(project))
        assert (
            client.delete(reverse("article-detail", kwargs={"pk": created.data["id"]})).status_code
            == 204
        )

        again = client.post(reverse("article-list"), article_payload(project))
        assert again.status_code == 201

    def test_the_same_title_may_sit_on_two_projects(
        self, auth_client, exec_user, project, other_project
    ):
        client = auth_client(exec_user)
        assert client.post(reverse("article-list"), article_payload(project)).status_code == 201
        assert (
            client.post(reverse("article-list"), article_payload(other_project)).status_code == 201
        )

    @pytest.mark.parametrize("field", ["title", "body"])
    def test_blank_text_is_rejected(self, auth_client, lead, project, field):
        response = auth_client(lead).post(
            reverse("article-list"), article_payload(project, **{field: "   "})
        )
        assert response.status_code == 400
        assert field in response.data

    def test_text_is_trimmed(self, auth_client, lead, project):
        response = auth_client(lead).post(
            reverse("article-list"), article_payload(project, title="  Partner contacts  ")
        )
        assert response.data["title"] == "Partner contacts"


class TestTheOpenEditRule:
    """Anyone on this term's roster may edit any page. The module in one class."""

    @pytest.mark.parametrize(
        ("actor", "expected"),
        [("exec_user", 200), ("lead", 200), ("finance_lead", 200), ("volunteer", 200)],
    )
    def test_any_current_member_can_fix_someone_elses_page(
        self, request, auth_client, project, actor, expected
    ):
        # Started by a member who is nobody in the parametrised list, so each
        # actor is judged on their membership rather than on having written it.
        author = UserFactory(email="author@pilani.bits-pilani.ac.in")
        MembershipFactory(user=author, project=project, role=Role.VOLUNTEER)
        article = ArticleFactory(project=project, created_by=author, updated_by=author)

        response = auth_client(request.getfixturevalue(actor)).patch(
            reverse("article-detail", kwargs={"pk": article.pk}),
            {"body": "The school changed its timings — now 09:00."},
        )
        assert response.status_code == expected

    def test_a_past_lead_cannot_edit(self, auth_client, past_lead, project):
        """Write access ends with the membership, on this module as on the rest."""
        article = ArticleFactory(project=project)
        response = auth_client(past_lead).patch(
            reverse("article-detail", kwargs={"pk": article.pk}), {"body": "Still in charge."}
        )
        assert response.status_code == 403

    def test_an_outsider_cannot_edit(self, auth_client, outsider, project):
        article = ArticleFactory(project=project)
        response = auth_client(outsider).patch(
            reverse("article-detail", kwargs={"pk": article.pk}), {"title": "Mine now"}
        )
        assert response.status_code == 404

    def test_an_article_cannot_be_moved_to_another_project(
        self, auth_client, exec_user, project, other_project
    ):
        article = ArticleFactory(project=project)
        response = auth_client(exec_user).patch(
            reverse("article-detail", kwargs={"pk": article.pk}), {"project": other_project.pk}
        )
        assert response.status_code == 400
        assert "project" in response.data

    def test_a_rename_onto_a_live_title_is_rejected(self, auth_client, lead, project):
        ArticleFactory(project=project, title="Partner contacts")
        other = ArticleFactory(project=project, title="Transport")
        response = auth_client(lead).patch(
            reverse("article-detail", kwargs={"pk": other.pk}), {"title": "Partner contacts"}
        )
        assert response.status_code == 400
        assert "title" in response.data

    def test_a_page_can_keep_its_own_title(self, auth_client, lead, project):
        """The uniqueness check must exclude the row being edited."""
        article = ArticleFactory(project=project, title="Partner contacts")
        response = auth_client(lead).patch(
            reverse("article-detail", kwargs={"pk": article.pk}),
            {"title": "Partner contacts", "body": "Updated numbers."},
        )
        assert response.status_code == 200


class TestRevisions:
    def test_an_edit_records_a_version_and_moves_updated_by(
        self, auth_client, volunteer, lead, project
    ):
        article = ArticleFactory(
            project=project, created_by=lead, updated_by=lead, body="The old text."
        )
        response = auth_client(volunteer).patch(
            reverse("article-detail", kwargs={"pk": article.pk}),
            {"body": "The new text.", "revision_note": "Timings changed"},
        )
        assert response.status_code == 200

        article.refresh_from_db()
        # Who started it never changes; who last touched it does.
        assert article.created_by == lead
        assert article.updated_by == volunteer

        revision = article.revisions.first()
        assert (revision.body, revision.edited_by, revision.note) == (
            "The new text.",
            volunteer,
            "Timings changed",
        )

    def test_the_history_is_what_makes_open_editing_safe(self, auth_client, volunteer, project):
        """A rewrite cannot destroy what the page used to say."""
        client = auth_client(volunteer)
        created = client.post(
            reverse("article-list"), article_payload(project, body="Ask for Sunita.")
        )
        url = reverse("article-detail", kwargs={"pk": created.data["id"]})
        client.patch(url, {"body": "Ask for Ramesh."})

        history = client.get(revisions_url(Article.objects.get(pk=created.data["id"]))).data
        # Newest first, and the superseded text is still there in full.
        assert [row["body"] for row in history] == ["Ask for Ramesh.", "Ask for Sunita."]

    def test_restoring_is_an_ordinary_edit(self, auth_client, volunteer, lead, project):
        """No special endpoint: the old text goes back through the same check.

        Which is why nothing here grants a restore power — whoever may edit may
        restore, and whoever may not, cannot.
        """
        client = auth_client(volunteer)
        created = client.post(
            reverse("article-list"), article_payload(project, body="Ask for Sunita.")
        )
        url = reverse("article-detail", kwargs={"pk": created.data["id"]})
        auth_client(lead).patch(url, {"body": "Ask for Ramesh."})

        restored = client.patch(url, {"body": "Ask for Sunita.", "revision_note": "Reverting"})
        assert restored.status_code == 200
        assert restored.data["body"] == "Ask for Sunita."
        # Three versions, not two: restoring adds to the history rather than
        # rewinding it, so the detour is still on the record.
        assert restored.data["revision_count"] == 3

    def test_an_edit_that_changes_nothing_records_nothing(self, auth_client, volunteer, project):
        client = auth_client(volunteer)
        created = client.post(reverse("article-list"), article_payload(project))
        url = reverse("article-detail", kwargs={"pk": created.data["id"]})

        again = client.patch(url, {"body": article_payload(project)["body"]})
        assert again.status_code == 200
        # Still just the version the page was created at.
        assert again.data["revision_count"] == 1

    def test_a_no_op_edit_does_not_reattribute_the_page(
        self, auth_client, volunteer, lead, project
    ):
        """`updated_by` follows the text, not the request."""
        client = auth_client(lead)
        created = client.post(reverse("article-list"), article_payload(project))
        url = reverse("article-detail", kwargs={"pk": created.data["id"]})

        auth_client(volunteer).patch(url, {"title": article_payload(project)["title"]})
        assert Article.objects.get(pk=created.data["id"]).updated_by == lead

    def test_a_past_member_can_read_the_history(self, auth_client, past_lead, volunteer, project):
        """Working out when a fact changed is exactly what an alum comes back for."""
        created = auth_client(volunteer).post(reverse("article-list"), article_payload(project))
        article = Article.objects.get(pk=created.data["id"])

        response = auth_client(past_lead).get(revisions_url(article))
        assert response.status_code == 200
        assert len(response.data) == 1

    def test_an_outsider_cannot_read_the_history(self, auth_client, outsider, project):
        article = ArticleFactory(project=project)
        assert auth_client(outsider).get(revisions_url(article)).status_code == 404

    def test_history_survives_removal_of_the_page(self, auth_client, lead, project):
        """The delete is soft, so the versions behind it are still there."""
        created = auth_client(lead).post(reverse("article-list"), article_payload(project))
        article = Article.objects.get(pk=created.data["id"])
        auth_client(lead).delete(reverse("article-detail", kwargs={"pk": article.pk}))

        assert ArticleRevision.objects.filter(article=article).count() == 1


class TestArticleRemoval:
    """Narrow, exactly where editing is wide: removal is moderation."""

    def test_whoever_started_a_page_can_remove_it(self, auth_client, volunteer, project):
        article = ArticleFactory(project=project, created_by=volunteer, updated_by=volunteer)
        response = auth_client(volunteer).delete(
            reverse("article-detail", kwargs={"pk": article.pk})
        )
        assert response.status_code == 204
        # Soft, unlike the resource shelf: the row is the content, not a pointer.
        article.refresh_from_db()
        assert article.is_deleted

    @pytest.mark.parametrize(
        ("actor", "expected"),
        [("exec_user", 204), ("lead", 204), ("finance_lead", 204), ("volunteer", 403)],
    )
    def test_who_can_remove_someone_elses_page(
        self, request, auth_client, project, actor, expected
    ):
        author = UserFactory(email="author@pilani.bits-pilani.ac.in")
        MembershipFactory(user=author, project=project, role=Role.VOLUNTEER)
        article = ArticleFactory(project=project, created_by=author, updated_by=author)

        response = auth_client(request.getfixturevalue(actor)).delete(
            reverse("article-detail", kwargs={"pk": article.pk})
        )
        assert response.status_code == expected

    def test_a_volunteer_who_cannot_remove_a_page_can_still_edit_it(
        self, auth_client, volunteer, project
    ):
        """The asymmetry stated directly: fixing is open, removing is not."""
        author = UserFactory(email="author@pilani.bits-pilani.ac.in")
        MembershipFactory(user=author, project=project, role=Role.VOLUNTEER)
        article = ArticleFactory(project=project, created_by=author, updated_by=author)
        url = reverse("article-detail", kwargs={"pk": article.pk})

        assert auth_client(volunteer).delete(url).status_code == 403
        assert auth_client(volunteer).patch(url, {"body": "Corrected."}).status_code == 200

    def test_a_past_lead_cannot_remove(self, auth_client, past_lead, project):
        article = ArticleFactory(project=project)
        response = auth_client(past_lead).delete(
            reverse("article-detail", kwargs={"pk": article.pk})
        )
        assert response.status_code == 403
