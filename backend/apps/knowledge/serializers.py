from rest_framework import serializers

from apps.accounts.serializers import UserSerializer

from .models import Article, ArticleRevision

#: Characters of the body carried in the index. Long enough to tell two pages
#: with similar titles apart, short enough that a knowledge base of forty
#: articles is still one small response.
EXCERPT_LENGTH = 240


def _excerpt(body: str) -> str:
    flat = " ".join(body.split())
    if len(flat) <= EXCERPT_LENGTH:
        return flat
    # Cut on a word boundary so the ellipsis does not land mid-word.
    head = flat[:EXCERPT_LENGTH].rsplit(" ", 1)[0]
    return f"{head}…"


class ArticleRevisionSerializer(serializers.ModelSerializer):
    """One version of a page, with the text it held.

    The body travels with the row so the SPA can preview an old version, and
    offer it back into the editor, without a request per revision.
    """

    edited_by = UserSerializer(read_only=True)

    class Meta:
        model = ArticleRevision
        fields = ["id", "title", "body", "category", "edited_by", "note", "created_at"]
        read_only_fields = fields


class ArticleBaseSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    updated_by = UserSerializer(read_only=True)
    project_slug = serializers.SlugRelatedField(source="project", slug_field="slug", read_only=True)
    revision_count = serializers.SerializerMethodField()

    def get_revision_count(self, obj: Article) -> int:
        """How many versions this page has been through.

        Reads the annotation the viewset attaches when there is one, and counts
        otherwise: a create or update response serializes the instance that was
        just saved, which never carries it.
        """
        annotated = getattr(obj, "revision_count", None)
        return annotated if annotated is not None else obj.revisions.count()

    def validate_project(self, value):
        # Same rule as `DailyLogSerializer` and `ResourceSerializer`: write
        # permission is judged against the project the row already belongs to,
        # so an edit that could change it would sidestep the check it just
        # passed for the project it was leaving.
        if self.instance is not None and value != self.instance.project:
            raise serializers.ValidationError("An article cannot be moved to another project.")
        return value

    def validate_title(self, value: str) -> str:
        title = value.strip()
        if not title:
            raise serializers.ValidationError("Give the page a name.")
        return title

    def validate_body(self, value: str) -> str:
        body = value.strip()
        if not body:
            raise serializers.ValidationError("An empty page is not knowledge. Write something.")
        return body

    def validate(self, attrs):
        """Enforce one live page per title per project.

        Checked by hand rather than left to a ``UniqueTogetherValidator``,
        because the constraint behind it is partial — soft-deleted rows are
        excluded — and DRF's validator would query the whole table and refuse a
        title freed up by a removal.
        """
        instance = self.instance
        project = attrs.get("project") or (instance.project if instance else None)
        title = attrs.get("title") or (instance.title if instance else None)
        if project is None or title is None:
            return attrs

        clash = Article.objects.alive().filter(project=project, title=title)
        if instance is not None:
            clash = clash.exclude(pk=instance.pk)
        if clash.exists():
            raise serializers.ValidationError(
                {"title": "This project already has a page with that name."}
            )
        return attrs


class ArticleListSerializer(ArticleBaseSerializer):
    """A page as it appears in the index — everything but the text of it.

    The body is replaced by an excerpt so that opening a project's knowledge
    base does not download every word in it. The detail route carries the whole
    thing.
    """

    excerpt = serializers.SerializerMethodField()

    class Meta:
        model = Article
        fields = [
            "id",
            "project",
            "project_slug",
            "category",
            "title",
            "excerpt",
            "revision_count",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_excerpt(self, obj: Article) -> str:
        return _excerpt(obj.body)


class ArticleSerializer(ArticleBaseSerializer):
    """One page in full, and the only serializer that writes."""

    revision_note = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        max_length=200,
        help_text=(
            "What changed, in a few words. Stored on the revision this write "
            "creates, not on the article."
        ),
    )

    class Meta:
        model = Article
        fields = [
            "id",
            "project",
            "project_slug",
            "category",
            "title",
            "body",
            "revision_note",
            "revision_count",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_by",
            "updated_by",
            "revision_count",
            "created_at",
            "updated_at",
        ]
