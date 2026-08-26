from rest_framework import serializers

from apps.accounts.models import User
from apps.accounts.serializers import UserSerializer

from .models import DailyLog


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
            "attendees",
            "attendee_ids",
            "author",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "author", "created_at", "updated_at"]

    def validate_project(self, value):
        # Write permission is decided against the project the entry already
        # belongs to, so letting an edit change it would sidestep that check
        # and drop the entry onto a timeline the editor may not even belong to.
        if self.instance is not None and value != self.instance.project:
            raise serializers.ValidationError("An entry cannot be moved to another project.")
        return value
