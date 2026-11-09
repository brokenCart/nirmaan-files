from rest_framework import serializers

from apps.accounts.serializers import UserSerializer
from apps.drive.images import StoredImageSerializer

from .models import Reimbursement, ReimbursementReceipt, ReimbursementStatus


class ReimbursementReceiptSerializer(StoredImageSerializer):
    class Meta(StoredImageSerializer.Meta):
        model = ReimbursementReceipt


class ReimbursementSerializer(serializers.ModelSerializer):
    """One claim, as it is read and as the submitter writes it.

    Deliberately cannot write the decision. ``status``, ``reviewed_by``,
    ``reviewed_at`` and ``review_note`` are all read-only here and are set only
    through :class:`ReimbursementReviewSerializer` on the ``review`` action —
    filing a claim and signing one off are different acts by different people
    under different rules, and one writable ``status`` field would collapse them
    into a PATCH that the viewset would then have to unpick.
    """

    # `amount` is left to the ModelSerializer to build. Unlike the URLField
    # case the resource shelf has to work around, DRF keeps a model
    # DecimalField's `max_digits`, `decimal_places` and `MinValueValidator`,
    # so the column's rules are the API's rules with nothing restated here.
    # A hand-written `validate_amount` would also never run: field validators
    # raise before `validate_<field>` is reached.
    submitted_by = UserSerializer(read_only=True)
    # `allow_null` on a read-only nested serializer changes nothing at
    # runtime and everything in the schema: without it the generated client
    # types `reviewed_by` as a `User`, and the SPA's "has anyone signed this
    # off yet" check would be a null test TypeScript believes can never fail.
    reviewed_by = UserSerializer(read_only=True, allow_null=True)
    receipts = ReimbursementReceiptSerializer(source="live_receipts", many=True, read_only=True)
    project_slug = serializers.SlugRelatedField(source="project", slug_field="slug", read_only=True)
    # Derived from the clock at creation, never sent by the client — see
    # `Reimbursement.save`.
    semester = serializers.PrimaryKeyRelatedField(read_only=True)
    semester_slug = serializers.SlugRelatedField(
        source="semester", slug_field="slug", read_only=True
    )

    class Meta:
        model = Reimbursement
        fields = [
            "id",
            "project",
            "project_slug",
            "semester",
            "semester_slug",
            "title",
            "amount",
            "description",
            "receipts",
            "status",
            "submitted_by",
            "reviewed_by",
            "reviewed_at",
            "review_note",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "semester",
            "semester_slug",
            "status",
            "submitted_by",
            "reviewed_by",
            "reviewed_at",
            "review_note",
            "created_at",
            "updated_at",
        ]

    def validate_project(self, value):
        # Same rule as `DailyLogSerializer`, `ResourceSerializer` and
        # `ArticleSerializer`: write permission is judged against the project the
        # row already belongs to, so an edit that could change it would sidestep
        # the check it just passed for the project it was leaving.
        if self.instance is not None and value != self.instance.project:
            raise serializers.ValidationError("A request cannot be moved to another project.")
        return value

    def validate_title(self, value: str) -> str:
        title = value.strip()
        if not title:
            raise serializers.ValidationError("Say what the money was for.")
        return title

    def validate_description(self, value: str) -> str:
        description = value.strip()
        if not description:
            raise serializers.ValidationError(
                "Describe the expense — whoever reviews this has only what you write here."
            )
        return description


class ReimbursementReviewSerializer(serializers.Serializer):
    """The body of ``POST /api/reimbursements/{id}/review/``.

    A serializer of its own rather than a corner of the model one, because the
    two describe different acts: this is the only place ``status`` is writable,
    and it is writable to two of the three values — a decision is a decision, so
    a reviewer cannot set a claim back to ``PENDING``. Undoing a decision is
    making the other one, which stays on the record with the reviewer's name on
    it.
    """

    # Pairs rather than bare values, so the generated schema carries the human
    # labels ("Approved") instead of repeating the constant back at the reader.
    status = serializers.ChoiceField(
        choices=[
            (status.value, status.label)
            for status in (ReimbursementStatus.APPROVED, ReimbursementStatus.REJECTED)
        ]
    )
    note = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=2000,
        help_text="Why. Required when rejecting.",
    )

    def validate(self, attrs):
        """A rejection must say why.

        The one piece of validation in this module that is about people rather
        than data. A claim turned down with no reason tells the volunteer
        nothing they can act on, and the next thing that happens is they refile
        it unchanged. An approval needs no note: the money arriving is the
        message.
        """
        note = (attrs.get("note") or "").strip()
        if attrs["status"] == ReimbursementStatus.REJECTED and not note:
            raise serializers.ValidationError(
                {"note": "Say why you are turning this down — the volunteer sees this note."}
            )
        attrs["note"] = note
        return attrs
