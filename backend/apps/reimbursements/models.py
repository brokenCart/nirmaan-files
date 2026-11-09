from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone

from apps.drive.models import StoredImage
from apps.projects.models import Role

#: Roles that see a project's whole queue rather than only their own requests.
#: Running a project includes knowing what is being claimed against it, so a
#: lead reads the queue — they just do not decide it.
QUEUE_ROLES = frozenset({Role.LEAD, Role.FINANCE_LEAD})

#: Roles that may approve or reject. Narrower than :data:`QUEUE_ROLES` by one
#: role, and that gap is the module: ``FINANCE_LEAD`` exists precisely to carry
#: the money, and this is the first power in the codebase it holds that a plain
#: lead does not. Exec bypasses, which is also the escape hatch for a project
#: that has no finance lead this term.
REVIEWER_ROLES = frozenset({Role.FINANCE_LEAD})


class ReimbursementStatus(models.TextChoices):
    """Where a request stands.

    Three states and no draft. A ``DailyLog`` draft is one person's unfinished
    account of their own visit, private until they publish it; a reimbursement
    request is addressed to somebody from the moment it is worth writing down,
    and a private half-filed claim is one that quietly never gets paid.
    """

    PENDING = "PENDING", "Awaiting review"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"


class ReimbursementQuerySet(models.QuerySet):
    def alive(self):
        return self.filter(is_deleted=False)

    def visible_to(self, request):
        """Rows the requesting user may read.

        Two rules stacked, and the order matters. The outer one is the project
        boundary every module shares — membership in *any* semester, so someone
        who left still sees what they claimed and whether it was paid. The inner
        one is a privacy rule with the same shape as draft privacy on the
        timeline: **a volunteer sees their own requests and nobody else's**,
        while staff see the project's whole queue.

        That inner set resolves against the **current** term, via
        ``membership_roles``, and doing it any other way is the trap this
        codebase keeps warning about. A lead who stepped down last year still
        passes the outer check; reading the queue off the unscoped set would
        hand them this year's claims — other people's money — on a screen they
        should only see their own line of.
        """
        from apps.projects.permissions import membership_roles, visible_project_ids

        qs = self.alive()
        project_ids = visible_project_ids(request)
        if project_ids is None:
            # Exec: org-wide, no membership row anywhere, sees every queue.
            return qs

        qs = qs.filter(project_id__in=project_ids)
        queue_project_ids = [
            project_id
            for project_id, role in membership_roles(request).items()
            if role in QUEUE_ROLES
        ]
        return qs.filter(
            models.Q(submitted_by=request.user) | models.Q(project_id__in=queue_project_ids)
        )


class Reimbursement(models.Model):
    """A volunteer's claim for money spent on the project, and its review.

    **Scoped to a semester**, unlike a resource or an article and like a log.
    The rubric is whether the row records something that *happened on a date* or
    describes what *exists now*: a Drive folder is the same folder it was last
    term, but a claim is an event — money went out, somebody signed it off, and
    the budget it came from restarts each August along with everything else this
    app counts. A finance lead opening the queue wants this term's, not three
    years of settled claims, so the term is stored and the list defaults to it.

    Derived from the clock rather than from a date field, which is the one place
    this differs from ``DailyLog``. A log carries ``occurred_on`` because a visit
    is written up days later and belongs to the day it happened; a request is
    filed when it is filed. There is deliberately no "spent on" date in v1 — see
    the scope note below.

    **Content freezes at the decision.** Only the submitter may edit, only while
    the request is still ``PENDING``, and only in the open term. That rule is
    doing more work than it looks: an approval is an approval *of specific
    content*, and a claim whose text can change after it is signed off is a
    signature on a blank page.

    Deletes are soft, like a log's and unlike a resource's. This row is the
    content, not a pointer at content, and a settled claim is a financial
    record — the thing you least want a table to forget.

    Receipts are :class:`ReimbursementReceipt` rows. They follow the same
    freeze, so proof cannot be swapped after approval.
    """

    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="reimbursements",
    )
    # PROTECT, matching `DailyLog.semester`: deleting a term that has claims
    # filed in it would delete the record of them.
    semester = models.ForeignKey(
        "projects.Semester",
        on_delete=models.PROTECT,
        related_name="reimbursements",
    )
    title = models.CharField(max_length=200)
    description = models.TextField(help_text="What the money was spent on, and why.")

    # Decimal, never float: money that has to add up. DRF serializes it as a
    # string for the same reason, so no rounding is possible between here and
    # the browser.
    #
    # NOT NULL, and folded into the initial migration rather than added by a
    # second one: this module had not shipped when the field was asked for, so
    # there were no rows to backfill and no reason to carry a nullable column
    # meaning "filed before we recorded amounts" for a state that can never
    # occur. Every claim has a number.
    #
    # `max_digits=10` allows ₹99,999,999.99 — absurd headroom for a student
    # society, and the cheapest possible way to never think about the ceiling.
    # The floor is a real rule: `MinValueValidator` refuses zero and negatives,
    # because a claim for nothing is a mistake and a negative one is a refund
    # this module does not model.
    #
    # No currency field. Nirmaan is one campus spending rupees; a second column
    # nothing would ever set is worse than the assumption written down. The SPA
    # formats it in one place (`formatRupees`).
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
        help_text="What is being claimed back, in rupees.",
    )

    status = models.CharField(
        max_length=12,
        choices=ReimbursementStatus.choices,
        default=ReimbursementStatus.PENDING,
    )

    # PROTECT, matching `DailyLog.author`, `Resource.added_by` and
    # `Article.created_by`: deleting the person must not take the project's
    # financial record with them. `discard_placeholder_user` checks it.
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="submitted_reimbursements",
    )

    # Null until somebody decides. PROTECT for the reason `edited_by` on a
    # revision is: a decision is only worth keeping if it still says who made it.
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="reviewed_reimbursements",
        null=True,
        blank=True,
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(
        blank=True,
        help_text="Why it was approved or turned down. Required when rejecting.",
    )

    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ReimbursementQuerySet.as_manager()

    class Meta:
        # Newest first, like the timeline and unlike the shelf: this is a queue
        # that gets worked through, not a reference list that gets scanned, and
        # the thing a finance lead opens it for is what has just come in.
        ordering = ["-created_at", "-id"]
        indexes = [
            # The queue: one project, one term, filtered by status.
            models.Index(fields=["project", "semester", "status"]),
            # "What have I claimed", which is the volunteer's whole view.
            models.Index(fields=["submitted_by", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.title} — {self.get_status_display()} ({self.project})"

    def save(self, *args, **kwargs):
        # Stamped here rather than in the serializer so the admin, the seed
        # command and the shell all file requests into the same term. Only when
        # unset — nothing re-derives it, because unlike a log there is no date
        # field a later edit could move.
        if self.semester_id is None:
            from apps.projects.models import Semester

            self.semester = Semester.current()
        return super().save(*args, **kwargs)

    @property
    def is_pending(self) -> bool:
        return self.status == ReimbursementStatus.PENDING

    def record_decision(self, reviewer, status: str, note: str = "") -> None:
        """Sign off on the request, or turn it down.

        Stamps the decision, who made it and when, in one write. Re-reviewing an
        already-decided request is allowed while the term is open and simply
        re-stamps all three: a finance lead who approves the wrong row needs a
        way back that is not "ask exec", and the alternative — a decision that
        can only be undone by deleting the claim — would lose the record of it
        having been made at all.
        """
        self.status = status
        self.review_note = note
        self.reviewed_by = reviewer
        self.reviewed_at = timezone.now()
        self.save(update_fields=["status", "review_note", "reviewed_by", "reviewed_at"])

    @property
    def live_receipts(self) -> list[ReimbursementReceipt]:
        # Filtered in Python for the same reason as `DailyLog.live_images`.
        return [receipt for receipt in self.receipts.all() if not receipt.is_deleted]


class ReimbursementReceipt(StoredImage):
    """A photo of a receipt, as proof for a claim."""

    content_url_name = "reimbursement-receipt-content"

    reimbursement = models.ForeignKey(
        Reimbursement, on_delete=models.CASCADE, related_name="receipts"
    )

    def __str__(self) -> str:
        return f"{self.original_name} on request {self.reimbursement_id}"
