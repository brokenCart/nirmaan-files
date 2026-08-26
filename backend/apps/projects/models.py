import datetime

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from django.utils.text import slugify


class Semester(models.Model):
    """One academic term, org-wide.

    The axis everything else is counted along. A project's visit and meeting
    totals restart each term, and so does its roster: the same person can lead
    *Shiksha* this semester and have been a volunteer there last one, which is
    two ``Membership`` rows, not an edit to one.

    Terms are explicit rows rather than a formula over dates because the BITS
    calendar shifts year to year, and because exec needs a lever to open one.
    """

    name = models.CharField(max_length=60, unique=True, help_text='e.g. "2025-26 Sem 1".')
    slug = models.SlugField(max_length=80, unique=True, blank=True)
    starts_on = models.DateField()
    ends_on = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Newest first: the current term is what almost every caller wants.
        ordering = ["-starts_on"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(ends_on__gt=models.F("starts_on")),
                name="semester_ends_after_it_starts",
            )
        ]
        indexes = [models.Index(fields=["starts_on", "ends_on"])]

    def __str__(self) -> str:
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)[:80]
        return super().save(*args, **kwargs)

    def clean(self):
        """Reject a term that overlaps another.

        Enforced here rather than as a Postgres exclusion constraint because
        that needs the ``btree_gist`` extension, which a managed database may
        not let the migration create. Two semesters a year are written through
        one exec-only endpoint, so the race this leaves open is not a real one.
        """
        super().clean()
        if self.starts_on is None or self.ends_on is None:
            return
        if self.ends_on <= self.starts_on:
            raise ValidationError({"ends_on": "A semester must end after it starts."})

        clash = (
            Semester.objects.exclude(pk=self.pk)
            .filter(starts_on__lte=self.ends_on, ends_on__gte=self.starts_on)
            .first()
        )
        if clash is not None:
            raise ValidationError(
                f"These dates overlap {clash.name} "
                f"({clash.starts_on:%d %b %Y} – {clash.ends_on:%d %b %Y})."
            )

    @classmethod
    def for_date(cls, on: datetime.date) -> Semester | None:
        """The term ``on`` belongs to.

        Falls back to the most recently *ended* term when the date lands in a
        gap between them — a visit during the summer break belongs to the term
        that was last running, not to nothing. Returns ``None`` only when the
        date precedes every term on record, which is a signal that exec has yet
        to create it.
        """
        containing = cls.objects.filter(starts_on__lte=on, ends_on__gte=on).first()
        if containing is not None:
            return containing
        return cls.objects.filter(ends_on__lt=on).order_by("-ends_on").first()

    @classmethod
    def current(cls) -> Semester | None:
        """The term in progress today, or the last one to have ended."""
        return cls.for_date(timezone.localdate())

    @property
    def is_current(self) -> bool:
        current = Semester.current()
        return current is not None and current.pk == self.pk


class Role(models.TextChoices):
    """Roles held *within* a project.

    Executive Committee is deliberately absent: it is org-wide and lives on
    ``accounts.User.is_exec``. Everything here is scoped to one project, so the
    same person can lead one vertical and volunteer in another.
    """

    LEAD = "LEAD", "Project Lead"
    FINANCE_LEAD = "FINANCE_LEAD", "Project Finance Lead"
    VOLUNTEER = "VOLUNTEER", "Volunteer"


class Project(models.Model):
    """A Nirmaan vertical."""

    name = models.CharField(max_length=120, unique=True)
    slug = models.SlugField(max_length=140, unique=True, blank=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="Membership",
        related_name="projects",
    )

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)[:140]
        return super().save(*args, **kwargs)


class Membership(models.Model):
    """Binds a user to a project with exactly one role, for one semester.

    Uniqueness is per *(user, project, semester)*, not per (user, project): a
    volunteer promoted to lead next term is a second row, and last term's row
    stays untouched as the record of what they were when the archived logs were
    filed. Rewriting the role in place would rewrite history.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    semester = models.ForeignKey(
        Semester,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.VOLUNTEER)
    is_active = models.BooleanField(default=True)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["project__name", "user__email"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "project", "semester"],
                name="unique_membership_per_user_project_semester",
            )
        ]
        indexes = [
            models.Index(fields=["project", "semester", "role"]),
            # Answers "every project this user has ever been in", which is what
            # archive read access resolves against.
            models.Index(fields=["user", "is_active"]),
        ]

    def __str__(self) -> str:
        return f"{self.user} — {self.get_role_display()} of {self.project} ({self.semester})"
