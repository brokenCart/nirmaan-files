from rest_framework import serializers

from .models import User


class UserSerializer(serializers.ModelSerializer):
    has_signed_in = serializers.SerializerMethodField(
        help_text="False for a placeholder a lead added by email that nobody has claimed yet."
    )

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "avatar_url", "is_exec", "has_signed_in"]
        read_only_fields = fields

    def get_has_signed_in(self, obj: User) -> bool:
        """Whether this row has ever been claimed by a Google login.

        Derived from ``google_sub`` rather than exposing it: the presence of a
        subject identifier is the useful fact, the identifier itself is not the
        SPA's business. Drives the roster's "never signed in" treatment and the
        wording of the remove confirmation, since removing an unclaimed row
        takes the account with it.
        """
        return obj.google_sub is not None


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
