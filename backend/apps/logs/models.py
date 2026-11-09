from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.drive.models import StoredImage


def validate_half_hour_step(value: Decimal) -> None:
    """Half-hour steps: a 30-minute call is real, a 1.3-hour one is false precision."""
    if value % Decimal("0.5") != 0:
        raise ValidationError("Hours must be in half-hour steps, such as 1, 1.5 or 2.")


class LogKind(models.TextChoices):
    MOV = "MOV", "Moment of Visit"
    MOM = "MOM", "Minutes of Meeting"


class LogStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    PUBLISHED = "PUBLISHED", "Published"


class DailyLogQuerySet(models.QuerySet):
    def alive(self):
        return self.filter(is_deleted=False)

    def visible_to(self, request):
        """Rows the requesting user may read.

        Scoped to projects the user has been a member of in *any* semester, not
        just the current one: leaving a project does not un-write the entries
        that were filed while you were in it. Writing is a different question
        and a narrower one — see :mod:`apps.projects.permissions`.

        Drafts stay private to their author until published; exec and project
        staff see everything else in their projects.
        """
        from apps.projects.permissions import visible_project_ids

        qs = self.alive()
        project_ids = visible_project_ids(request)
        if project_ids is not None:
            qs = qs.filter(project_id__in=project_ids)
        return qs.exclude(models.Q(status=LogStatus.DRAFT) & ~models.Q(author=request.user))


class DailyLog(models.Model):
    """A dated entry on a project's timeline.

    MOVs and MOMs share one table because the primary screen is a single
    reverse-chronological feed per project — one indexed query rather than a
    union of two. ``kind`` carries the distinction and every field applies to
    both. Split the models only if the two genuinely diverge.

    Photos hang off an entry as :class:`LogImage` rows; video is still deferred.
    """

    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="logs",
    )
    # Derived from `occurred_on`, then stored: counting restarts each term, and
    # a stored key means the archive is one indexed lookup rather than a date
    # range join against a table exec can edit underneath it. PROTECT because
    # deleting a term that has entries in it would delete the record itself.
    semester = models.ForeignKey(
        "projects.Semester",
        on_delete=models.PROTECT,
        related_name="logs",
    )
    kind = models.CharField(max_length=8, choices=LogKind.choices)
    title = models.CharField(max_length=200)
    body = models.TextField(help_text="Markdown.")
    occurred_on = models.DateField(help_text="The day the visit or meeting happened.")
    # Decimal rather than float so a member's total is exact. Set per entry, so
    # every attendee is credited the same hours for it.
    hours = models.DecimalField(
        max_digits=3,
        decimal_places=1,
        default=Decimal("1.0"),
        validators=[
            MinValueValidator(Decimal("0.5")),
            MaxValueValidator(Decimal("24.0")),
            validate_half_hour_step,
        ],
        help_text="How long the visit or meeting lasted, in half-hour steps.",
    )

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="authored_logs",
    )
    status = models.CharField(max_length=12, choices=LogStatus.choices, default=LogStatus.PUBLISHED)

    # Both kinds: who was there. Visit and meeting counts per person are
    # derived from this, so a MOV carries attendees just as a MOM does.
    attendees = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name="attended_logs",
        blank=True,
    )

    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = DailyLogQuerySet.as_manager()

    class Meta:
        ordering = ["-occurred_on", "-created_at"]
        indexes = [
            models.Index(fields=["project", "-occurred_on"]),
            models.Index(fields=["project", "kind"]),
            # The archive reads one term of one project at a time.
            models.Index(fields=["project", "semester", "-occurred_on"]),
        ]

    def __str__(self) -> str:
        return f"[{self.kind}] {self.title} ({self.occurred_on})"

    def save(self, *args, **kwargs):
        # Resolved here rather than in the serializer so the admin, the seed
        # command and the shell all stamp entries the same way. Only when unset:
        # callers that need to re-derive after a date change clear it first.
        if self.semester_id is None and self.occurred_on is not None:
            from apps.projects.models import Semester

            self.semester = Semester.for_date(self.occurred_on)
        return super().save(*args, **kwargs)

    @property
    def live_images(self) -> list[LogImage]:
        # Filtered in Python so a prefetch of `images` is used. DRF drops the
        # prefetch cache after an update, and this stays right either way.
        return [image for image in self.images.all() if not image.is_deleted]


class LogImage(StoredImage):
    """A photo attached to an entry."""

    content_url_name = "log-image-content"

    log = models.ForeignKey(DailyLog, on_delete=models.CASCADE, related_name="images")

    def __str__(self) -> str:
        return f"{self.original_name} on log {self.log_id}"
