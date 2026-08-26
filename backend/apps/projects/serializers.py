from django.conf import settings
from rest_framework import serializers

from apps.accounts.domain import is_allowed_email
from apps.accounts.models import User
from apps.accounts.serializers import UserSerializer

from .models import Membership, Project


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
        """The requesting user's role here, or ``EXEC`` for committee members."""
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

    class Meta:
        model = Membership
        fields = ["id", "user", "user_email", "project", "role", "is_active", "joined_at"]
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
