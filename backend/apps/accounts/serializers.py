from rest_framework import serializers

from .models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name", "avatar_url", "is_exec"]
        read_only_fields = fields


class GoogleLoginSerializer(serializers.Serializer):
    credential = serializers.CharField(
        write_only=True,
        help_text="The ID token issued by Google Identity Services.",
    )


class MembershipSummarySerializer(serializers.Serializer):
    """A user's role in one project, for the session payload."""

    project_id = serializers.IntegerField()
    project_slug = serializers.CharField()
    project_name = serializers.CharField()
    role = serializers.CharField()


class SessionSerializer(serializers.Serializer):
    """What the SPA needs immediately after login."""

    access = serializers.CharField()
    user = UserSerializer()
    memberships = MembershipSummarySerializer(many=True)
