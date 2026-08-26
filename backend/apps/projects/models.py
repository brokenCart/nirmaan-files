from django.conf import settings
from django.db import models
from django.utils.text import slugify


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
    # Seam for the deferred media work: uploads will land in this folder and
    # members will be granted read access on it. Unused in v1.
    drive_folder_url = models.URLField(blank=True)
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
    """Binds a user to a project with exactly one role."""

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
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.VOLUNTEER)
    is_active = models.BooleanField(default=True)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["project__name", "user__email"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "project"],
                name="unique_membership_per_user_project",
            )
        ]
        indexes = [models.Index(fields=["project", "role"])]

    def __str__(self) -> str:
        return f"{self.user} — {self.get_role_display()} of {self.project}"
