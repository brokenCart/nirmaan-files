from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.validators import UniqueTogetherValidator

from apps.accounts.serializers import UserSerializer

from .models import Resource, web_url_validator


class ResourceSerializer(serializers.ModelSerializer):
    added_by = UserSerializer(read_only=True)
    project_slug = serializers.SlugRelatedField(source="project", slug_field="slug", read_only=True)

    class Meta:
        model = Resource
        fields = [
            "id",
            "project",
            "project_slug",
            "kind",
            "title",
            "url",
            "description",
            "added_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "added_by", "created_at", "updated_at"]
        # Declared rather than left to the constraint's generated validator,
        # which words it as "the fields project, url must make a unique set" —
        # true, and no use to someone who has just pasted a link twice.
        validators = [
            UniqueTogetherValidator(
                queryset=Resource.objects.all(),
                fields=["project", "url"],
                message="That link is already on this project's list.",
            )
        ]

    def validate_project(self, value):
        # Same rule as `DailyLogSerializer`: write permission is judged against
        # the project the row already belongs to, so allowing an edit to change
        # it would move the link onto a shelf the editor may not be able to
        # write — having passed the check for the one they were leaving.
        if self.instance is not None and value != self.instance.project:
            raise serializers.ValidationError("A resource cannot be moved to another project.")
        return value

    def validate_url(self, value: str) -> str:
        """Re-assert the http/https rule the model already carries.

        DRF drops every ``URLValidator`` it finds on a model ``URLField`` and
        substitutes its own default-scheme one, so the model's stricter copy
        never runs through the API — it guards the admin and the shell only.
        Asserting it here is what actually keeps an `ftp://` link off the shelf.
        """
        url = value.strip()
        try:
            web_url_validator(url)
        except DjangoValidationError as error:
            raise serializers.ValidationError(error.messages) from error
        return url

    def validate_title(self, value: str) -> str:
        title = value.strip()
        if not title:
            raise serializers.ValidationError("Give the link a name.")
        return title
