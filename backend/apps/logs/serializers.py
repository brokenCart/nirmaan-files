from rest_framework import serializers

from apps.accounts.models import User
from apps.accounts.serializers import UserSerializer

from .models import DailyLog, LogKind


class DailyLogSerializer(serializers.ModelSerializer):
    author = UserSerializer(read_only=True)
    attendee_ids = serializers.PrimaryKeyRelatedField(
        source="attendees",
        queryset=User.objects.all(),
        many=True,
        required=False,
        write_only=True,
    )
    attendees = UserSerializer(many=True, read_only=True)
    project_slug = serializers.SlugRelatedField(source="project", slug_field="slug", read_only=True)

    class Meta:
        model = DailyLog
        fields = [
            "id",
            "project",
            "project_slug",
            "kind",
            "title",
            "body",
            "occurred_on",
            "location",
            "attendees",
            "attendee_ids",
            "author",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "author", "created_at", "updated_at"]

    def validate(self, attrs):
        kind = attrs.get("kind", getattr(self.instance, "kind", None))
        # Keep kind-specific fields from drifting onto the wrong kind, since one
        # table backs both.
        if kind == LogKind.MOM and attrs.get("location"):
            raise serializers.ValidationError({"location": "Location applies to a MOV, not a MOM."})
        if kind == LogKind.MOV and attrs.get("attendees"):
            raise serializers.ValidationError(
                {"attendee_ids": "Attendees apply to a MOM, not a MOV."}
            )
        return attrs
