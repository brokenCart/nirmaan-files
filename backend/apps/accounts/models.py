from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.translation import gettext_lazy as _

from .domain import is_allowed_email


def validate_campus_email(value: str) -> None:
    if not is_allowed_email(value):
        raise ValidationError(
            _("Only Pilani-campus BITS accounts are allowed."),
            code="disallowed_domain",
        )


class UserManager(BaseUserManager):
    """Manager for a user model keyed on email rather than username."""

    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra):
        if not email:
            raise ValueError("Users must have an email address.")
        email = self.normalize_email(email).lower()
        user = self.model(email=email, **extra)
        user.set_password(password)
        user.full_clean(exclude=["password"])
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("is_exec", True)
        if not extra["is_staff"] or not extra["is_superuser"]:
            raise ValueError("Superuser must have is_staff and is_superuser set.")
        return self._create_user(email, password, **extra)


class User(AbstractUser):
    """A Nirmaan member.

    Identity comes from Google, so ``username`` is dropped in favour of the
    campus email. ``is_exec`` is the only org-wide role — every other role is
    per-project and lives on ``projects.Membership``.
    """

    username = None  # type: ignore[assignment]
    first_name = None  # type: ignore[assignment]
    last_name = None  # type: ignore[assignment]

    email = models.EmailField(
        _("email address"),
        unique=True,
        validators=[validate_campus_email],
    )
    full_name = models.CharField(max_length=150, blank=True)
    google_sub = models.CharField(
        max_length=255,
        unique=True,
        null=True,
        blank=True,
        help_text="Google's stable subject identifier. Survives email changes.",
    )
    avatar_url = models.URLField(blank=True)
    is_exec = models.BooleanField(
        default=False,
        help_text="Executive Committee: org-wide read access across every project.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    objects = UserManager()

    class Meta:
        ordering = ["email"]

    def __str__(self) -> str:
        return self.full_name or self.email

    def save(self, *args, **kwargs):
        self.email = self.email.lower()
        return super().save(*args, **kwargs)
