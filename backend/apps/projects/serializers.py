from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.accounts.domain import is_allowed_email
from apps.accounts.models import User
from apps.accounts.serializers import UserSerializer

from .models import Membership, Project, Semester


class SemesterSerializer(serializers.ModelSerializer):
    is_current = serializers.BooleanField(read_only=True)

    class Meta:
        model = Semester
        fields = ["id", "name", "slug", "starts_on", "ends_on", "is_current", "created_at"]
        read_only_fields = ["id", "slug", "is_current", "created_at"]

    def validate(self, attrs):
        # `clean()` holds the overlap rule, and DRF never calls full_clean().
        candidate = Semester(**{**self._current_values(), **attrs})
        candidate.pk = self.instance.pk if self.instance else None
        try:
            candidate.clean()
        except DjangoValidationError as error:
            raise serializers.ValidationError(serializers.as_serializer_error(error)) from error
        return attrs

    def _current_values(self) -> dict:
        if self.instance is None:
            return {}
        return {
            "name": self.instance.name,
            "starts_on": self.instance.starts_on,
            "ends_on": self.instance.ends_on,
        }


class ProjectSerializer(serializers.ModelSerializer):
    my_role = serializers.SerializerMethodField()
    member_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Project
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "is_active",
            "drive_folder_url",
            "member_count",
            "my_role",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "slug", "created_at", "updated_at"]

    def get_my_role(self, obj: Project) -> str | None:
        """The requesting user's role here **this semester**, or ``EXEC``.

        ``null`` on a project the caller can nevertheless see means archive-only
        access: they were a member in some past term and were not carried into
        this one. The SPA reads it that way to decide whether to offer a
        compose box.
        """
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return None
        from .permissions import role_in_project

        role = role_in_project(request, obj.pk)
        if role is None and request.user.is_exec:
            return "EXEC"
        return role


class MembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    user_email = serializers.EmailField(write_only=True)
    semester = serializers.PrimaryKeyRelatedField(
        queryset=Semester.objects.all(),
        required=False,
        help_text="Defaults to the current semester.",
    )
    semester_slug = serializers.SlugRelatedField(
        source="semester", slug_field="slug", read_only=True
    )

    class Meta:
        model = Membership
        fields = [
            "id",
            "user",
            "user_email",
            "project",
            "semester",
            "semester_slug",
            "role",
            "is_active",
            "joined_at",
        ]
        read_only_fields = ["id", "joined_at"]

    def validate_user_email(self, value: str) -> str:
        email = value.strip().lower()
        # The model validator only fires under full_clean(), which DRF does not
        # call, so the domain rule is re-asserted here.
        if not is_allowed_email(email):
            raise serializers.ValidationError(
                f"Only @{settings.ALLOWED_EMAIL_DOMAIN} addresses can be added to a project."
            )
        return email

    def create(self, validated_data):
        email = validated_data.pop("user_email")
        # A lead may add someone who has never logged in. The placeholder row is
        # adopted on their first Google sign-in, which matches on email.
        user = User.objects.filter(email=email).first()
        if user is None:
            user = User(email=email)
            user.set_unusable_password()  # sign-in is Google-only
            user.save()
        validated_data["user"] = user
        return super().create(validated_data)


class ArchiveTermSerializer(serializers.Serializer):
    """One semester's line in a project's archive — see ``ProjectViewSet.archive``.

    Read-only: every number is derived from the timeline.
    """

    semester = SemesterSerializer(read_only=True)
    visits = serializers.IntegerField(read_only=True)
    meetings = serializers.IntegerField(read_only=True)
    member_count = serializers.IntegerField(read_only=True)
    leads = UserSerializer(many=True, read_only=True)
