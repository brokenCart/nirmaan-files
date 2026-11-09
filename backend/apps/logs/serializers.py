from rest_framework import serializers

from apps.accounts.models import User
from apps.accounts.serializers import UserSerializer
from apps.drive.images import StoredImageSerializer

from .models import DailyLog, LogImage


class LogImageSerializer(StoredImageSerializer):
    class Meta(StoredImageSerializer.Meta):
        model = LogImage


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
    images = LogImageSerializer(source="live_images", many=True, read_only=True)
    project_slug = serializers.SlugRelatedField(source="project", slug_field="slug", read_only=True)
    # Derived from `occurred_on`, never sent by the client — see `DailyLog.save`.
    semester = serializers.PrimaryKeyRelatedField(read_only=True)
    semester_slug = serializers.SlugRelatedField(
        source="semester", slug_field="slug", read_only=True
    )

    class Meta:
        model = DailyLog
        fields = [
            "id",
            "project",
            "project_slug",
            "semester",
            "semester_slug",
            "kind",
            "title",
            "body",
            "occurred_on",
            "hours",
            "attendees",
            "attendee_ids",
            "images",
            "author",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "author",
            "semester",
            "semester_slug",
            "created_at",
            "updated_at",
        ]
        # A JSON number, not DRF's default string, so the API type is `number`.
        extra_kwargs = {"hours": {"coerce_to_string": False}}

    def validate_project(self, value):
        # Write permission is decided against the project the entry already
        # belongs to, so letting an edit change it would sidestep that check
        # and drop the entry onto a timeline the editor may not even belong to.
        if self.instance is not None and value != self.instance.project:
            raise serializers.ValidationError("An entry cannot be moved to another project.")
        return value

    def validate_occurred_on(self, value):
        from apps.projects.models import Semester

        if Semester.for_date(value) is None:
            raise serializers.ValidationError(
                "That date falls before the first semester on record. "
                "Ask the Executive Committee to create the term first."
            )
        return value

    def update(self, instance, validated_data):
        # Moving the date can move the entry to another term, so the stored key
        # is cleared and `DailyLog.save` re-derives it. The viewset has already
        # refused edits that would cross out of the open semester.
        moved = validated_data.get("occurred_on", instance.occurred_on) != instance.occurred_on
        if moved:
            instance.semester = None
        return super().update(instance, validated_data)


class AttendanceRowSerializer(serializers.Serializer):
    """One member's attendance on a project, in one semester.

    See :mod:`apps.logs.stats`. Read-only: the numbers are derived from the
    timeline, never written.
    """

    user = UserSerializer(read_only=True)
    role = serializers.CharField(read_only=True)
    visits = serializers.IntegerField(read_only=True)
    meetings = serializers.IntegerField(read_only=True)
    total = serializers.SerializerMethodField()
    hours = serializers.DecimalField(
        max_digits=7, decimal_places=1, coerce_to_string=False, read_only=True
    )

    def get_total(self, membership) -> int:
        return membership.visits + membership.meetings
