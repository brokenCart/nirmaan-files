from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_GET
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import status as http_status
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.drive.images import (
    MAX_IMAGES_PER_OWNER,
    ImageUploadSerializer,
    attach_image,
    serve_image,
)
from apps.projects.models import Project, Semester
from apps.projects.permissions import IsProjectMember, current_semester, role_in_project

from .models import (
    QUEUE_ROLES,
    REVIEWER_ROLES,
    Reimbursement,
    ReimbursementReceipt,
    ReimbursementStatus,
)
from .pagination import ReimbursementPagination
from .serializers import (
    ReimbursementReceiptSerializer,
    ReimbursementReviewSerializer,
    ReimbursementSerializer,
)

#: Kept apart from the term folders that hold photos, which people may share.
RECEIPTS_SECTION = "Receipts"

QUEUE_PARAMS = [
    OpenApiParameter(name="project", description="Project slug.", required=False, type=str),
    OpenApiParameter(
        name="status",
        description="One ReimbursementStatus — PENDING is the review queue.",
        required=False,
        type=str,
    ),
    OpenApiParameter(
        name="semester",
        description="Semester slug, or `all`. Defaults to the term in progress.",
        required=False,
        type=str,
    ),
    OpenApiParameter(
        name="mine",
        description="`true` narrows the list to the caller's own requests.",
        required=False,
        type=bool,
    ),
    OpenApiParameter(
        name="q",
        description="Free-text match over title, details and who filed it.",
        required=False,
        type=str,
    ),
]


@extend_schema_view(list=extend_schema(parameters=QUEUE_PARAMS))
class ReimbursementViewSet(viewsets.ModelViewSet):
    """Money claimed back from a project, and the finance lead's review of it.

    Read rules — narrower than every other module's, because this is the only
    screen in the app where one member's row is none of another member's
    business:

      * a volunteer sees **their own requests**, on any project they have ever
        belonged to;
      * a **lead or finance lead** sees the project's whole queue for the terms
        they hold that role in;
      * exec sees everything, as always.

    Write rules:

      * any member of the project **this semester** may file a request;
      * only the **submitter** may edit one, and only while it is still
        ``PENDING`` — a decision is a decision about specific content, so the
        content stops moving the moment somebody signs it;
      * only a **finance lead**, or exec, may approve or reject, and **nobody
        reviews their own request**;
      * the submitter may withdraw a pending request; staff may remove one; once
        reviewed it is a financial record and only exec removes it;
      * a closed semester is frozen, as on the timeline.

    Two of those are worth saying out loud because they are new here.

    **Reviewing is the finance lead's, not the lead's.** ``FINANCE_LEAD`` has
    until now been a synonym for ``LEAD`` everywhere in this codebase — both are
    "project staff" and both get the same write powers. This is the first place
    they come apart, and it is the role's actual job: the lead runs the project
    and can see what is being claimed against it, the finance lead is the one
    who signs. A project with no finance lead this term is not stuck, because
    exec bypasses; if that turns out to be the common case rather than the
    exception, widening :data:`~apps.reimbursements.models.REVIEWER_ROLES` to
    include ``LEAD`` is the whole change.

    **Nobody reviews their own request**, exec included, and this holds even
    though a finance lead is exactly the sort of person who buys things for the
    project. It is the same shape as ``_assert_not_self`` on the roster and for
    the same reason: someone else does it, so the decision is witnessed rather
    than unilateral. A finance lead's own claim goes to exec or to a second
    finance lead. Authority is checked *before* selfhood, so a volunteer poking
    at the endpoint gets the generic refusal rather than a hint about whose row
    it is.
    """

    serializer_class = ReimbursementSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    pagination_class = ReimbursementPagination
    # Schema introspection only; get_queryset() is what actually runs.
    queryset = Reimbursement.objects.none()

    def _scoped_queryset(self):
        """Everything the caller may read, narrowed by the filters they share.

        The pieces both the list and the summary apply — the search included. ``status`` is
        deliberately not among them — a summary is a count *per* status, so
        honouring it there would leave every other bucket reading zero.
        """
        qs = Reimbursement.objects.visible_to(self.request).select_related(
            "project", "semester", "submitted_by", "reviewed_by"
        )
        params = self.request.query_params
        if project_slug := params.get("project"):
            qs = qs.filter(project__slug=project_slug)
        if params.get("mine") == "true":
            # Not a permission, just a lens: a finance lead who is also claiming
            # for a bus fare needs to see their own line among the queue they
            # are working through.
            qs = qs.filter(submitted_by=self.request.user)
        if search := params.get("q", "").strip():
            # Here rather than in `get_queryset`, so the summary narrows with
            # the list: tab counts and totals describe what the search found.
            # A plain ILIKE, as on the timeline and the knowledge base.
            qs = qs.filter(
                Q(title__icontains=search)
                | Q(description__icontains=search)
                | Q(submitted_by__full_name__icontains=search)
                | Q(submitted_by__email__icontains=search)
            )
        return qs

    def _in_requested_term(self, qs):
        """Apply ``?semester=``, defaulting to the term in progress.

        Scoping to a term is a property of the *queue*, not of a claim, so this
        is applied by the list and the summary and by neither of the detail
        routes — a settled request must be reachable by its own URL, or every
        403 the frozen-term rule is meant to return would arrive as a 404.
        """
        semester = self.request.query_params.get("semester")
        if semester == "all":
            return qs
        if semester:
            return qs.filter(semester__slug=semester)
        current = current_semester(self.request)
        return qs.filter(semester=current) if current else qs.none()

    def get_queryset(self):
        # Here rather than in `_scoped_queryset`: the summary only aggregates.
        qs = self._scoped_queryset().prefetch_related("receipts")
        if self.action != "list":
            return qs
        if status := self.request.query_params.get("status"):
            qs = qs.filter(status=status)
        return self._in_requested_term(qs)

    def _open_semester(self) -> Semester:
        current = current_semester(self.request)
        if current is None:
            raise ValidationError(
                "No semester has been created yet. Ask the Executive Committee to open the term."
            )
        return current

    def _assert_current_member(self, project: Project) -> str:
        """The caller's role on ``project`` this term, or a 403 explaining.

        Reading is wider than writing here as everywhere: `visible_to` admits
        anyone who was ever a member, so the roster check happens on the way in
        rather than being assumed upstream.
        """
        role = role_in_project(self.request, project.pk)
        if role is None:
            raise PermissionDenied(
                "You are not a member of this project this semester. "
                "You can see what you claimed but not file anything new."
            )
        return role

    def _assert_is_open(self, instance: Reimbursement) -> None:
        """Refuse to touch a request that belongs to a closed term."""
        current = current_semester(self.request)
        if current is None or instance.semester_id != current.pk:
            raise PermissionDenied(
                f"{instance.semester} has ended. Requests from a past semester are part "
                "of the record and cannot be changed."
            )

    def _assert_can_edit(self, instance: Reimbursement) -> None:
        # Term, then roster, then authorship, then status — refusals get more
        # specific as the caller gets closer to being allowed, so a past member
        # is told the archive is closed rather than that the request is settled.
        self._assert_is_open(instance)

        user = self.request.user
        if not user.is_exec and role_in_project(self.request, instance.project_id) is None:
            raise PermissionDenied(
                "You are not a member of this project this semester. "
                "You can read your requests but no longer change them."
            )

        # No role overrides this, exec included — the same rule the timeline
        # applies to an entry, and for a related reason. A claim is one person's
        # statement of what they spent; a finance lead who could reword it could
        # approve a claim its submitter never made.
        if instance.submitted_by_id != user.pk:
            raise PermissionDenied(
                "Only whoever filed this request can change it. A finance lead reviews it instead."
            )

        # The freeze that makes an approval mean something. See `Reimbursement`.
        if not instance.is_pending:
            raise PermissionDenied(
                f"This request has already been {instance.get_status_display().lower()}. "
                "Ask the finance lead to reopen it, or file a new one."
            )

    def _assert_can_review(self, instance: Reimbursement) -> None:
        """Gate a decision: the finance lead, or exec, and never on your own."""
        user = self.request.user

        if not user.is_exec:
            self._assert_is_open(instance)
            role = self._assert_current_member(instance.project)
            if role not in REVIEWER_ROLES:
                raise PermissionDenied(
                    "Only the project's finance lead or the Executive Committee "
                    "can approve or reject a reimbursement request."
                )

        # Checked last, so someone with no authority here never learns whose
        # request it is. Binds exec too: bypassing every other rule is not a
        # reason to be able to sign off your own money.
        if instance.submitted_by_id == user.pk:
            raise PermissionDenied(
                "You cannot review your own request. "
                "Ask another finance lead or the Executive Committee."
            )

    def _assert_can_delete(self, instance: Reimbursement) -> None:
        user = self.request.user
        if user.is_exec:
            # Exec keeps the lever over the whole archive, as on the timeline.
            # The delete is soft, so this hides the row, not the record.
            return

        self._assert_is_open(instance)

        if not instance.is_pending:
            raise PermissionDenied(
                "A reviewed request is part of the project's financial record. "
                "Ask the Executive Committee if it has to go."
            )

        role = self._assert_current_member(instance.project)
        if role in QUEUE_ROLES:
            return
        if instance.submitted_by_id != user.pk:
            raise PermissionDenied("You can only withdraw your own requests.")

    def perform_create(self, serializer):
        project = serializer.validated_data.get("project")
        if project is None:
            raise ValidationError({"project": "This field is required."})
        # Resolved before the roster check so a project with no open term fails
        # as a 400 about the term rather than a 403 about the caller.
        self._open_semester()
        if not self.request.user.is_exec:
            self._assert_current_member(project)
        # `status` is read-only on the serializer, so a posted one is dropped
        # rather than honoured — a request cannot be filed pre-approved.
        serializer.save(submitted_by=self.request.user)

    def perform_update(self, serializer):
        self._assert_can_edit(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        # Soft, like a log's and unlike a resource's: this row is the record,
        # not a pointer at one.
        self._assert_can_delete(instance)
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted"])

    @extend_schema(request=ReimbursementReviewSerializer, responses=ReimbursementSerializer)
    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        """Approve or reject one request.

        A POST to its own route rather than a PATCH of ``status``, because the
        permission rule here is not the one that governs editing — the person
        allowed to do this is precisely the person not allowed to do that. Given
        its own endpoint, the rules sit side by side instead of branching inside
        one handler on which field changed.

        Re-reviewing an already-decided request is allowed while the term is
        open and re-stamps the decision; see ``record_decision``.
        """
        instance = self.get_object()
        self._assert_can_review(instance)

        body = ReimbursementReviewSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        instance.record_decision(
            request.user,
            status=body.validated_data["status"],
            note=body.validated_data.get("note", ""),
        )
        return Response(ReimbursementSerializer(instance).data)

    @extend_schema(
        request={"multipart/form-data": ImageUploadSerializer},
        responses={201: ReimbursementReceiptSerializer},
    )
    @action(detail=True, methods=["post"], url_path="receipts", parser_classes=[MultiPartParser])
    def add_receipt(self, request, pk=None):
        """Attach one receipt image. Proof is content, so it freezes at the decision too."""
        instance = self.get_object()
        self._assert_can_edit(instance)
        receipt = attach_image(
            ReimbursementReceipt,
            request.data,
            existing=len(instance.live_receipts),
            limit_message=f"A request can hold {MAX_IMAGES_PER_OWNER} receipts.",
            project=instance.project,
            semester=instance.semester,
            label=f"{instance.created_at.date()} {instance.title[:60]}",
            owner={"reimbursement": instance},
            section=RECEIPTS_SECTION,
        )
        return Response(
            ReimbursementReceiptSerializer(receipt).data, status=http_status.HTTP_201_CREATED
        )

    @extend_schema(
        request=None,
        responses={204: None},
        parameters=[OpenApiParameter("receipt_id", int, OpenApiParameter.PATH)],
    )
    @action(detail=True, methods=["delete"], url_path=r"receipts/(?P<receipt_id>\d+)")
    def remove_receipt(self, request, pk=None, receipt_id=None):
        """Remove one receipt, under the same rule as adding one."""
        instance = self.get_object()
        self._assert_can_edit(instance)
        receipt = get_object_or_404(instance.receipts.all(), pk=receipt_id, is_deleted=False)
        receipt.is_deleted = True
        receipt.save(update_fields=["is_deleted"])
        return Response(status=http_status.HTTP_204_NO_CONTENT)

    @extend_schema(
        parameters=QUEUE_PARAMS,
        responses={
            200: {
                "type": "object",
                "properties": {
                    status.value: {
                        "type": "object",
                        "properties": {
                            "count": {"type": "integer"},
                            # A string for the reason `amount` is one: money
                            # does not survive a float.
                            "total": {"type": "string", "format": "decimal"},
                        },
                        "required": ["count", "total"],
                    }
                    for status in ReimbursementStatus
                },
                "required": [status.value for status in ReimbursementStatus],
            }
        },
    )
    @action(detail=False, methods=["get"])
    def summary(self, request):
        """How many requests sit in each state, and what they come to.

        Exists because the list is paginated and a badge saying "3 waiting,
        ₹4,200" must not depend on which page you are on. It runs the same
        visibility and the same term scope as the list, so a volunteer's summary
        covers a volunteer's own requests and a finance lead's covers the queue —
        there is no second place for that rule to be got wrong.

        The totals are what make this endpoint carry its weight now that a
        request has an amount. What a finance lead needs on opening the screen is
        not "four requests" but "₹4,200 waiting on me", and summing the page in
        hand would have answered a different question.

        Every status is present even at zero, so the client renders a fixed row
        of tabs without filling in gaps.
        """
        qs = self._in_requested_term(self._scoped_queryset())
        # `order_by()` clears the model's default ordering, which Django would
        # otherwise fold into the GROUP BY and split every status across as many
        # rows as there are distinct timestamps.
        rows = {
            row["status"]: row
            for row in qs.order_by()
            .values("status")
            .annotate(count=Count("pk"), total=Sum("amount"))
        }
        return Response(
            {
                status.value: {
                    "count": rows.get(status.value, {}).get("count", 0),
                    # A string, matching the field itself, so the client never
                    # sees a total a float round-trip has moved. `Sum` over no
                    # rows is None, which reads as "0.00" rather than as missing.
                    "total": str(rows.get(status.value, {}).get("total") or Decimal("0.00")),
                }
                for status in ReimbursementStatus
            }
        )


@require_GET
def receipt_content(request, pk: int):
    return serve_image(
        request,
        pk,
        ReimbursementReceipt.objects.filter(is_deleted=False, reimbursement__is_deleted=False),
    )
