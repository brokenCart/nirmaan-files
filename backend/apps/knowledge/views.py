from django.db import transaction
from django.db.models import Count, Q
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.projects.models import Project, Role
from apps.projects.permissions import IsProjectMember, role_in_project

from .models import Article
from .serializers import ArticleListSerializer, ArticleRevisionSerializer, ArticleSerializer

INDEX_PARAMS = [
    OpenApiParameter(name="project", description="Project slug.", required=False, type=str),
    OpenApiParameter(name="category", description="One ArticleCategory.", required=False, type=str),
    OpenApiParameter(
        name="q",
        description="Free-text match over page titles and bodies.",
        required=False,
        type=str,
    ),
]


@extend_schema_view(list=extend_schema(parameters=INDEX_PARAMS))
class ArticleViewSet(viewsets.ModelViewSet):
    """A project's knowledge base — what the next batch needs to know.

    Write rules:

      * any member of the project **this semester** may start a page;
      * **any member of the project this semester may edit any page** — the one
        genuinely open write rule in this codebase;
      * whoever started it, plus leads, finance leads and exec, may remove one;
      * a past member reads the knowledge base and writes nothing, as everywhere
        else.

    The open edit rule is the module, not a relaxation of it. Nirmaan's roster
    turns over completely every year, and a knowledge base that only its
    original authors may correct is a pile of confidently-worded stale facts
    within two terms. The volunteer who discovers that the partner school
    changed its timings is rarely the lead, and making them file a request to
    someone who will also have graduated is how the fact gets lost.

    What makes that safe is :class:`~apps.knowledge.models.ArticleRevision`:
    every save snapshots the version it replaced, attributed and timestamped, so
    an edit can be read, judged and undone. Compare the timeline, which has the
    opposite shape — an entry is one person's account of what happened, so
    **nobody** may reword it and staff who disagree delete it instead. The
    difference is that a log is testimony and an article is a shared statement
    of what is currently true.

    Removal stays narrow for exactly the reason editing is wide. Editing is
    visible and reversible; removal takes the page off the index, so it is
    moderation and answers to the same set the timeline's does. It is soft, like
    a log's and unlike the shelf's — this is the module whose whole job is not
    losing things.

    There is no term boundary to enforce, because an article has no term: it
    states what is true now, not what happened on a date. See
    :class:`~apps.knowledge.models.Article`.
    """

    permission_classes = [IsAuthenticated, IsProjectMember]
    # Unpaginated, like the resource shelf and unlike the timeline. A knowledge
    # base is scanned for the one page you came for, and the index carries
    # excerpts rather than bodies (see `ArticleListSerializer`), so the whole of
    # a project's is a small response.
    pagination_class = None
    # Schema introspection only; get_queryset() is what actually runs.
    queryset = Article.objects.none()

    def get_serializer_class(self):
        # The index leaves out the bodies; everything else carries them.
        return ArticleListSerializer if self.action == "list" else ArticleSerializer

    def get_queryset(self):
        qs = (
            Article.objects.visible_to(self.request)
            .select_related("project", "created_by", "updated_by")
            .annotate(revision_count=Count("revisions"))
        )
        params = self.request.query_params
        if project_slug := params.get("project"):
            qs = qs.filter(project__slug=project_slug)
        if category := params.get("category"):
            qs = qs.filter(category=category)
        if search := params.get("q"):
            # A plain ILIKE over the two text fields rather than Postgres full
            # text search, which would want a stored `SearchVector`, a GIN index
            # and a trigger to keep it current. At a few dozen pages per project
            # the sequential scan is free, and this way "MOU" matches "MOU" —
            # a stemmer would not have made that better.
            qs = qs.filter(Q(title__icontains=search) | Q(body__icontains=search))
        return qs

    def _assert_current_member(self, project: Project) -> str:
        """The caller's role on ``project`` this term, or a 403 explaining.

        Reading is wider than writing here as everywhere: `visible_to` admits
        anyone who was ever a member, so the roster check happens on the way in
        rather than being assumed upstream.
        """
        role = role_in_project(self.request, project.pk)
        if role is None:
            raise PermissionDenied(
                "You are not a member of this project this semester. "
                "You can read its knowledge base but not write to it."
            )
        return role

    def _assert_can_edit(self, article: Article) -> None:
        """Gate an edit: anyone on this term's roster.

        Deliberately not a check on who wrote the page. See the class docstring
        — the history is what carries the risk here, not a permission.
        """
        if self.request.user.is_exec:
            return
        self._assert_current_member(article.project)

    def _assert_can_delete(self, article: Article) -> None:
        """Gate a removal: whoever started it, or whoever runs the project."""
        user = self.request.user
        if user.is_exec:
            return

        role = self._assert_current_member(article.project)
        if role in (Role.LEAD, Role.FINANCE_LEAD):
            return
        if article.created_by_id != user.pk:
            raise PermissionDenied(
                "Only whoever started this page, or a project lead, can remove it. "
                "Anyone on the roster can edit it instead."
            )

    @staticmethod
    def _refresh_revision_count(article: Article) -> None:
        """Re-count the versions before the write is serialized back.

        `get_queryset` annotates ``revision_count``, and on an update that
        annotation was computed when the row was fetched — one revision ago by
        the time the response is built. Left alone it reports a stale number to
        the client that just caused it to change.
        """
        article.revision_count = article.revisions.count()

    def perform_create(self, serializer):
        project = serializer.validated_data.get("project")
        if project is None:
            raise ValidationError({"project": "This field is required."})
        if not self.request.user.is_exec:
            self._assert_current_member(project)

        # Not a model field — it belongs to the revision this write creates.
        note = serializer.validated_data.pop("revision_note", "")
        user = self.request.user
        # Atomic so a page cannot exist with no history behind it; nothing here
        # runs under ATOMIC_REQUESTS.
        with transaction.atomic():
            article = serializer.save(created_by=user, updated_by=user)
            article.record_revision(user, note=note)
        self._refresh_revision_count(article)

    def perform_update(self, serializer):
        self._assert_can_edit(serializer.instance)
        note = serializer.validated_data.pop("revision_note", "")
        user = self.request.user
        with transaction.atomic():
            article = serializer.save()
            # Stamps `updated_by` too, and does neither when the text is
            # unchanged. `updated_at` still moves, which is what it is for: it
            # records the write, while the revisions record the writing.
            article.record_revision(user, note=note)
        self._refresh_revision_count(article)

    def perform_destroy(self, instance):
        self._assert_can_delete(instance)
        # Soft, like a log's: the knowledge base is the institutional memory
        # this whole module exists to keep.
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted"])

    @extend_schema(responses=ArticleRevisionSerializer(many=True))
    @action(detail=True, methods=["get"])
    def revisions(self, request, pk=None):
        """Every saved version of this page, newest first.

        Open to anyone who may read the page, which is anyone who has ever been
        a member — including someone long off the roster trying to work out when
        a fact changed and who changed it. `get_object` runs the same queryset
        as everything else, so a page in another project 404s here too.

        Unpaginated for the same reason the index is: the ceiling is a project's
        own edit rate, and one page revised weekly for four years is two hundred
        rows. The bodies travel with them so the SPA can preview an old version,
        and offer it back into the editor, without a request per revision.
        """
        article = self.get_object()
        rows = article.revisions.select_related("edited_by")
        return Response(ArticleRevisionSerializer(rows, many=True).data)
