from django.conf import settings
from django.db import models


class ArticleCategory(models.TextChoices):
    """What sort of knowledge an article carries.

    Presentational, like :class:`~apps.resources.models.ResourceKind` — nothing
    branches on it server-side. It exists because a knowledge base is read by
    someone looking for one particular thing, and a flat list of forty titles is
    not a way to find it.
    """

    CONTEXT = "CONTEXT", "Background"
    PROCESS = "PROCESS", "How we do it"
    PARTNER = "PARTNER", "People and partners"
    LESSON = "LESSON", "Lessons learned"
    OTHER = "OTHER", "Other"


class ArticleQuerySet(models.QuerySet):
    def alive(self):
        return self.filter(is_deleted=False)

    def visible_to(self, request):
        """Rows the requesting user may read.

        Scoped to projects the user has been a member of in *any* semester, the
        same read rule the timeline and the shelf use. There is no draft state
        to filter on — see :class:`Article` for why an article is public to the
        project the moment it is written.
        """
        from apps.projects.permissions import visible_project_ids

        qs = self.alive()
        project_ids = visible_project_ids(request)
        if project_ids is None:
            return qs
        return qs.filter(project_id__in=project_ids)


class Article(models.Model):
    """A page in a project's knowledge base — context, process, lore.

    **Not scoped to a semester**, for the reason
    :class:`~apps.resources.models.Resource` is not: a log is an account of
    something that happened on a date, so it belongs to the term it happened in,
    but an article states what is true *now*. The partner's contact is the
    partner's contact whatever term it is. Giving articles a term would empty
    every knowledge base each August, which is precisely backwards — a knowledge
    base exists because the roster turns over and the knowledge must not.

    That is also why there is **no draft state**, unlike ``DailyLog``. A draft
    there is one person's unfinished account of their own visit, private until
    they publish it. An article is collectively owned, and a half-written
    handover document that its author graduates away from would be invisible
    forever. Written is published; the revision history is what makes that safe
    to do early.

    **Any current member may edit any article**, which is wider than every other
    write rule in this codebase and is the defining property of the module. The
    volunteer who notices that a phone number changed is usually not the lead,
    and a knowledge base whose errors can only be fixed by whoever introduced
    them accumulates errors. What makes open editing safe is that nothing is
    ever overwritten: every save snapshots the version it replaced into
    :class:`ArticleRevision`, attributed and timestamped. Removal stays narrow,
    because that is moderation rather than authorship — see
    :class:`~apps.knowledge.views.ArticleViewSet`.

    Deletes are soft, as on the timeline and unlike the shelf. A stale *pointer*
    left as a tombstone serves nobody, but an article is the content itself, and
    this is the module whose entire job is not losing content.
    """

    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="articles",
    )
    category = models.CharField(
        max_length=12,
        choices=ArticleCategory.choices,
        default=ArticleCategory.OTHER,
    )
    title = models.CharField(max_length=200)
    body = models.TextField(help_text="Markdown.")

    # PROTECT, matching `DailyLog.author` and `Resource.added_by`: deleting the
    # person must not take the project's knowledge with them. Records who
    # started the page, not who it currently reads as — that is `updated_by`,
    # and the full chain is in `revisions`.
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="authored_articles",
    )
    # Denormalised from the newest revision so the index can render "updated by
    # X" without a subquery per row. Written only by `record_revision`, which is
    # also what writes the revision, so the two cannot drift.
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="edited_articles",
    )

    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ArticleQuerySet.as_manager()

    class Meta:
        # Grouped by topic and alphabetical within it, like the resource shelf
        # and unlike the timeline: this is a reference list that gets scanned,
        # so a page keeps its place instead of jumping to the top every time
        # somebody fixes a typo in it.
        ordering = ["category", "title"]
        constraints = [
            # Partial, unlike the shelf's: articles are soft-deleted, and a
            # plain constraint would let a removed page block its own
            # replacement from a row nobody can see.
            models.UniqueConstraint(
                fields=["project", "title"],
                condition=models.Q(is_deleted=False),
                name="unique_live_article_title_per_project",
            )
        ]
        indexes = [models.Index(fields=["project", "category"])]

    def __str__(self) -> str:
        return f"{self.title} ({self.project})"

    def record_revision(self, editor, note: str = "") -> ArticleRevision | None:
        """Snapshot the article's current text as a revision by ``editor``.

        Call *after* saving, so the row being snapshotted is the one that was
        just written. Stamps ``updated_by`` in the same breath, which is what
        keeps the denormalised field honest.

        Returns ``None`` when the versioned fields are unchanged from the latest
        revision — a PATCH that only touches, say, nothing at all, or that
        re-saves identical text, should not pad the history with a version
        indistinguishable from the one before it.
        """
        latest = self.revisions.first()
        if latest is not None and (latest.title, latest.body, latest.category) == (
            self.title,
            self.body,
            self.category,
        ):
            return None

        if self.updated_by_id != editor.pk:
            self.updated_by = editor
            self.save(update_fields=["updated_by", "updated_at"])

        return ArticleRevision.objects.create(
            article=self,
            title=self.title,
            body=self.body,
            category=self.category,
            edited_by=editor,
            note=note,
        )


class ArticleRevision(models.Model):
    """One saved version of an :class:`Article`, kept forever.

    A complete snapshot rather than a diff: the storage is trivial at this size,
    and a stored diff has to be replayed from the beginning to answer "what did
    this page say in March", which is the only question anybody asks of it.

    This is what pays for the open edit rule. Because every version survives
    with its author attached, a new lead rewriting a page they inherited cannot
    destroy what it said — the SPA offers the old text back into the editor, so
    restoring is an ordinary edit and answers to the ordinary permission check.

    CASCADE from the article, which sounds wrong for a history and is not: the
    API only ever soft-deletes, so the article row outlives everything the API
    can do to it. A hard delete is the admin or the shell deliberately expunging
    a page, and leaving its text behind in a side table would defeat the point.
    """

    article = models.ForeignKey(
        Article,
        on_delete=models.CASCADE,
        related_name="revisions",
    )
    title = models.CharField(max_length=200)
    body = models.TextField()
    category = models.CharField(max_length=12, choices=ArticleCategory.choices)

    # PROTECT for the same reason `Article.created_by` is: the history is only
    # worth keeping if it still says who wrote each version.
    edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="article_revisions",
    )
    note = models.CharField(
        max_length=200,
        blank=True,
        help_text="What changed, in a few words. Optional.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Newest first, and `-id` breaks the tie: `record_revision` reads
        # `.first()` to decide whether anything changed, and two saves inside
        # one clock tick would otherwise leave that answer to chance.
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["article", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.title} @ {self.created_at:%d %b %Y %H:%M}"
