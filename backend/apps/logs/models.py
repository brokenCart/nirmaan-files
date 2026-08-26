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

    Text-only in v1: photo and video attachments are deferred until the Google
    Drive storage question is settled.
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
