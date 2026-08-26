from django.conf import settings
from django.core.validators import URLValidator
from django.db import models

#: Links are rendered as anchors in the SPA and opened in a new tab, so the
#: scheme is pinned rather than left to Django's default, which also accepts
#: ``ftp``/``ftps``.
#:
#: This copy guards the admin, the shell and anything else that calls
#: ``full_clean``. It does **not** guard the API: DRF strips every
#: ``URLValidator`` off a model ``URLField`` and substitutes its own, so
#: ``ResourceSerializer.validate_url`` runs it again by hand. Both call the
#: same validator so the two cannot drift.
web_url_validator = URLValidator(
    schemes=["http", "https"],
    message="Enter a link starting with http:// or https://.",
)


class ResourceKind(models.TextChoices):
    """What sits at the other end of the link.

    Presentational rather than structural — nothing branches on it server-side.
    It exists so a shelf of a dozen links can be scanned at a glance, which is
    the whole job of this screen.
    """

    FOLDER = "FOLDER", "Drive folder"
    DOCUMENT = "DOCUMENT", "Document"
    SHEET = "SHEET", "Spreadsheet"
    FORM = "FORM", "Form"
    OTHER = "OTHER", "Link"


class ResourceQuerySet(models.QuerySet):
    def visible_to(self, request):
        """Rows the requesting user may read.

        Scoped to projects the user has been a member of in *any* semester, the
        same read rule the timeline uses: someone who ran a project two years
        ago can still open what it points at. There is no draft state and no
        soft delete here, so visibility is the project boundary and nothing
        else — see the class docstring for why.
        """
        from apps.projects.permissions import visible_project_ids

        project_ids = visible_project_ids(request)
        if project_ids is None:
            return self
        return self.filter(project_id__in=project_ids)


class Resource(models.Model):
    """A named link on a project's shelf — a Drive folder, a report, a form.

    **Not scoped to a semester**, unlike every other per-project row in this
    codebase, and that is the decision worth understanding. A log is an account
    of something that happened on a date, so it belongs to the term it happened
    in and the counting restarts each August. A resource is a pointer to
    something that exists *now*: the project's Drive folder is the same folder
    it was last term. Giving it a term would empty the shelf every rollover and
    hand every project the problem ``carry_forward_roster`` exists to solve,
    for no gain.

    Writing still resolves against the current term, because that is a question
    about the person rather than about the link: someone off this term's roster
    stops editing the shelf exactly as they stop filing entries.

    Deletes are hard, unlike a log's. The timeline is a published account and
    removing one is moderation, which is why it is reversible; a link is a
    pointer that goes stale, and a stale pointer left in the table as a tombstone
    serves nobody. Whatever it pointed at still exists in Drive either way.
    """

    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="resources",
    )
    kind = models.CharField(
        max_length=12,
        choices=ResourceKind.choices,
        default=ResourceKind.OTHER,
    )
    title = models.CharField(max_length=200)
    # Longer than the 200-character default: a Drive link carries a file id and
    # frequently a `?usp=` tail, and truncation would break the only field on
    # the row that has to be exact.
    url = models.URLField(max_length=500, validators=[web_url_validator])
    description = models.TextField(blank=True, help_text="What this is for, in a line or two.")

    # PROTECT, matching `DailyLog.author`: deleting the person should not take
    # the project's links with it. `discard_placeholder_user` knows to check
    # here before removing an unclaimed account.
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="added_resources",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ResourceQuerySet.as_manager()

    class Meta:
        # A reference list, not a feed: alphabetical within kind, so a link
        # keeps its place instead of moving every time someone adds another.
        ordering = ["kind", "title"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "url"],
                name="unique_resource_url_per_project",
            )
        ]
        indexes = [models.Index(fields=["project", "kind"])]

    def __str__(self) -> str:
        return f"{self.title} ({self.project})"
