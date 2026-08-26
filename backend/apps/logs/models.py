from django.conf import settings
from django.db import models


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
    union of two. ``kind`` carries the distinction and a few fields apply to
    only one kind. Split the models only if the two genuinely diverge.

    Text-only in v1: photo and video attachments are deferred until the Google
    Drive storage question is settled.
    """

    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="logs",
    )
    kind = models.CharField(max_length=8, choices=LogKind.choices)
    title = models.CharField(max_length=200)
    body = models.TextField(help_text="Markdown.")
    occurred_on = models.DateField(help_text="The day the visit or meeting happened.")

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="authored_logs",
    )
    status = models.CharField(max_length=12, choices=LogStatus.choices, default=LogStatus.PUBLISHED)

    # MOV-only.
    location = models.CharField(max_length=200, blank=True)
    # MOM-only.
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
        ]

    def __str__(self) -> str:
        return f"[{self.kind}] {self.title} ({self.occurred_on})"
