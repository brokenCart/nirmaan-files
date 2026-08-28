"""Reimbursement requests: who sees whose, who signs, and what freezes when.

Three rules here exist nowhere else in the codebase, and most of this file is
about them:

* a volunteer's queue is **their own rows only** — the first per-row read rule
  outside draft privacy;
* ``FINANCE_LEAD`` can do something ``LEAD`` cannot;
* **nobody reviews their own request**, exec included.
"""

import datetime
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.conftest import (
    CAMPUS,
    MembershipFactory,
    ReimbursementFactory,
    UserFactory,
)
from apps.projects.models import Role
from apps.reimbursements.models import Reimbursement, ReimbursementStatus

pytestmark = pytest.mark.django_db

LIST_URL = reverse("reimbursement-list")
SUMMARY_URL = reverse("reimbursement-summary")


def detail_url(reimbursement) -> str:
    return reverse("reimbursement-detail", kwargs={"pk": reimbursement.pk})


def review_url(reimbursement) -> str:
    return reverse("reimbursement-review", kwargs={"pk": reimbursement.pk})


def payload(project, **overrides):
    body = {
        "project": project.pk,
        "title": "Bus fare to the centre",
        "amount": "480.00",
        "description": "Four volunteers, return tickets, 27 August.",
    }
    body.update(overrides)
    return body


def titles(response) -> set[str]:
    return {row["title"] for row in response.data["results"]}


class TestQueueVisibility:
    """The read rule, which is narrower here than anywhere else in the app."""

    def test_a_volunteer_sees_only_their_own_requests(self, auth_client, volunteer, lead, project):
        ReimbursementFactory(project=project, submitted_by=volunteer, title="Mine")
        ReimbursementFactory(project=project, submitted_by=lead, title="Someone else's")

        response = auth_client(volunteer).get(LIST_URL)
        assert titles(response) == {"Mine"}

    @pytest.mark.parametrize("actor", ["lead", "finance_lead"])
    def test_staff_see_the_whole_queue(self, request, auth_client, volunteer, project, actor):
        reviewer = request.getfixturevalue(actor)
        ReimbursementFactory(project=project, submitted_by=volunteer, title="Theirs")
        ReimbursementFactory(project=project, submitted_by=reviewer, title="Mine")

        response = auth_client(reviewer).get(LIST_URL)
        assert titles(response) == {"Theirs", "Mine"}

    def test_exec_sees_every_projects_queue(
        self, auth_client, exec_user, volunteer, outsider, project, other_project
    ):
        ReimbursementFactory(project=project, submitted_by=volunteer, title="A")
        ReimbursementFactory(project=other_project, submitted_by=outsider, title="B")

        response = auth_client(exec_user).get(LIST_URL)
        assert titles(response) == {"A", "B"}

    def test_a_lead_of_one_project_does_not_see_anothers_queue(
        self, auth_client, lead, outsider, other_project
    ):
        ReimbursementFactory(project=other_project, submitted_by=outsider, title="Theirs")
        response = auth_client(lead).get(LIST_URL)
        assert titles(response) == set()

    def test_a_volunteer_cannot_open_someone_elses_request(
        self, auth_client, volunteer, lead, project
    ):
        theirs = ReimbursementFactory(project=project, submitted_by=lead)
        # Filtered out of the queryset, so 404 rather than 403 — the same answer
        # a foreign project gives, and for the same reason.
        assert auth_client(volunteer).get(detail_url(theirs)).status_code == 404

    def test_a_past_lead_keeps_their_own_rows_and_loses_the_queue(
        self, auth_client, past_lead, volunteer, project
    ):
        """The read/write split, applied to a read.

        `past_lead` still passes the project boundary, so resolving the queue
        against unscoped membership would hand them this term's claims — other
        people's money. Their own past row must survive, though: "was I ever
        paid" outlives the roster.
        """
        ReimbursementFactory(project=project, submitted_by=volunteer, title="This term's")
        ReimbursementFactory(project=project, submitted_by=past_lead, title="Mine, once")

        response = auth_client(past_lead).get(LIST_URL, {"semester": "all"})
        assert titles(response) == {"Mine, once"}

    def test_a_soft_deleted_request_disappears(self, auth_client, finance_lead, volunteer, project):
        ReimbursementFactory(
            project=project, submitted_by=volunteer, title="Withdrawn", is_deleted=True
        )
        assert titles(auth_client(finance_lead).get(LIST_URL)) == set()

    def test_anonymous_is_rejected(self, api):
        assert api.get(LIST_URL).status_code == 401


class TestQueueFilters:
    def test_the_queue_defaults_to_the_open_term(
        self, auth_client, finance_lead, volunteer, project, past_semester
    ):
        ReimbursementFactory(project=project, submitted_by=volunteer, title="Now")
        ReimbursementFactory(
            project=project, submitted_by=volunteer, title="Then", semester=past_semester
        )

        assert titles(auth_client(finance_lead).get(LIST_URL)) == {"Now"}

    def test_a_past_term_can_be_read_by_slug(
        self, auth_client, finance_lead, volunteer, project, past_semester
    ):
        ReimbursementFactory(project=project, submitted_by=volunteer, title="Now")
        ReimbursementFactory(
            project=project, submitted_by=volunteer, title="Then", semester=past_semester
        )

        response = auth_client(finance_lead).get(LIST_URL, {"semester": past_semester.slug})
        assert titles(response) == {"Then"}

    def test_a_settled_request_in_a_closed_term_is_still_reachable_by_url(
        self, auth_client, finance_lead, volunteer, project, past_semester
    ):
        """Detail routes must not inherit the list's term default.

        Otherwise every 403 the frozen-term rule returns would arrive as a 404,
        and the SPA could not open a permalink into last year.
        """
        old = ReimbursementFactory(project=project, submitted_by=volunteer, semester=past_semester)
        assert auth_client(finance_lead).get(detail_url(old)).status_code == 200

    def test_filtering_by_status(self, auth_client, finance_lead, volunteer, project):
        ReimbursementFactory(project=project, submitted_by=volunteer, title="Waiting")
        ReimbursementFactory(
            project=project,
            submitted_by=volunteer,
            title="Done",
            status=ReimbursementStatus.APPROVED,
        )

        response = auth_client(finance_lead).get(LIST_URL, {"status": "PENDING"})
        assert titles(response) == {"Waiting"}

    def test_mine_narrows_a_finance_leads_view_to_their_own(
        self, auth_client, finance_lead, volunteer, project
    ):
        ReimbursementFactory(project=project, submitted_by=volunteer, title="Theirs")
        ReimbursementFactory(project=project, submitted_by=finance_lead, title="Mine")

        response = auth_client(finance_lead).get(LIST_URL, {"mine": "true"})
        assert titles(response) == {"Mine"}

    def test_filtering_by_project_slug(
        self, auth_client, exec_user, volunteer, outsider, project, other_project
    ):
        ReimbursementFactory(project=project, submitted_by=volunteer, title="Mine")
        ReimbursementFactory(project=other_project, submitted_by=outsider, title="Theirs")

        response = auth_client(exec_user).get(LIST_URL, {"project": project.slug})
        assert titles(response) == {"Mine"}


class TestSummary:
    def test_counts_every_status_including_the_empty_ones(
        self, auth_client, finance_lead, volunteer, project
    ):
        ReimbursementFactory(project=project, submitted_by=volunteer, amount=Decimal("100.00"))
        ReimbursementFactory(
            project=project,
            submitted_by=volunteer,
            amount=Decimal("250.50"),
            status=ReimbursementStatus.APPROVED,
        )

        response = auth_client(finance_lead).get(SUMMARY_URL, {"project": project.slug})
        assert response.data == {
            "PENDING": {"count": 1, "total": "100.00"},
            "APPROVED": {"count": 1, "total": "250.50"},
            # An empty bucket reads as zero money, not as a missing value.
            "REJECTED": {"count": 0, "total": "0.00"},
        }

    def test_totals_add_up_across_rows(self, auth_client, finance_lead, volunteer, project):
        """The number a finance lead actually opens the screen for."""
        for amount in ("100.25", "200.25", "0.50"):
            ReimbursementFactory(project=project, submitted_by=volunteer, amount=Decimal(amount))

        response = auth_client(finance_lead).get(SUMMARY_URL, {"project": project.slug})
        assert response.data["PENDING"] == {"count": 3, "total": "301.00"}

    def test_the_summary_obeys_the_same_visibility_as_the_list(
        self, auth_client, volunteer, lead, project
    ):
        ReimbursementFactory(project=project, submitted_by=volunteer)
        ReimbursementFactory(project=project, submitted_by=lead)

        response = auth_client(volunteer).get(SUMMARY_URL, {"project": project.slug})
        assert response.data["PENDING"]["count"] == 1

    def test_the_summary_ignores_a_status_filter(
        self, auth_client, finance_lead, volunteer, project
    ):
        """A count *per* status cannot honour a filter *on* status.

        Left unguarded the badge would read "0 approved" the moment the reader
        clicked the pending tab.
        """
        ReimbursementFactory(project=project, submitted_by=volunteer, amount=Decimal("10.00"))
        ReimbursementFactory(
            project=project,
            submitted_by=volunteer,
            amount=Decimal("20.00"),
            status=ReimbursementStatus.APPROVED,
        )

        response = auth_client(finance_lead).get(
            SUMMARY_URL, {"project": project.slug, "status": "PENDING"}
        )
        assert response.data["APPROVED"] == {"count": 1, "total": "20.00"}


class TestFiling:
    @pytest.mark.parametrize("actor", ["volunteer", "lead", "finance_lead", "exec_user"])
    def test_any_current_member_can_file_a_request(self, request, auth_client, project, actor):
        user = request.getfixturevalue(actor)
        response = auth_client(user).post(LIST_URL, payload(project))
        assert response.status_code == 201

    def test_the_submitter_is_recorded(self, auth_client, volunteer, project):
        response = auth_client(volunteer).post(LIST_URL, payload(project))
        assert response.data["submitted_by"]["id"] == volunteer.pk

    def test_submitted_by_cannot_be_spoofed(self, auth_client, volunteer, lead, project):
        response = auth_client(volunteer).post(LIST_URL, payload(project, submitted_by=lead.pk))
        assert response.data["submitted_by"]["id"] == volunteer.pk

    def test_a_request_cannot_be_filed_pre_approved(self, auth_client, volunteer, project):
        response = auth_client(volunteer).post(
            LIST_URL, payload(project, status=ReimbursementStatus.APPROVED)
        )
        assert response.status_code == 201
        assert response.data["status"] == ReimbursementStatus.PENDING

    def test_the_review_fields_cannot_be_set_at_filing(
        self, auth_client, volunteer, finance_lead, project
    ):
        response = auth_client(volunteer).post(
            LIST_URL,
            payload(project, reviewed_by=finance_lead.pk, review_note="Fine by me."),
        )
        assert response.data["reviewed_by"] is None
        assert response.data["review_note"] == ""

    def test_the_open_term_is_stamped(self, auth_client, volunteer, project, semester):
        response = auth_client(volunteer).post(LIST_URL, payload(project))
        assert response.data["semester"] == semester.pk

    def test_an_outsider_cannot_file_against_another_project(self, auth_client, outsider, project):
        response = auth_client(outsider).post(LIST_URL, payload(project))
        # The project is invisible to them, so the serializer refuses the FK
        # before the roster check is even reached.
        assert response.status_code in (400, 403)
        assert not Reimbursement.objects.filter(project=project).exists()

    def test_a_past_member_cannot_file(self, auth_client, past_lead, project):
        response = auth_client(past_lead).post(LIST_URL, payload(project))
        assert response.status_code == 403

    @pytest.mark.parametrize("field", ["title", "description"])
    def test_blank_fields_are_refused(self, auth_client, volunteer, project, field):
        response = auth_client(volunteer).post(LIST_URL, payload(project, **{field: "   "}))
        assert response.status_code == 400
        assert field in response.data

    def test_the_amount_is_recorded(self, auth_client, volunteer, project):
        response = auth_client(volunteer).post(LIST_URL, payload(project, amount="1250.75"))
        assert response.status_code == 201
        # A string, not a float: money that has to add up must not round-trip
        # through a binary fraction on its way to the browser.
        assert response.data["amount"] == "1250.75"

    def test_the_amount_is_required(self, auth_client, volunteer, project):
        body = payload(project)
        del body["amount"]
        response = auth_client(volunteer).post(LIST_URL, body)
        assert response.status_code == 400
        assert "amount" in response.data

    @pytest.mark.parametrize("amount", ["0", "0.00", "-5.00"])
    def test_a_claim_for_nothing_or_less_is_refused(self, auth_client, volunteer, project, amount):
        """A claim for zero is a mistake; a negative one is a refund, which this
        module does not model — rejecting is how money fails to move."""
        response = auth_client(volunteer).post(LIST_URL, payload(project, amount=amount))
        assert response.status_code == 400
        assert "amount" in response.data

    def test_more_than_two_decimal_places_is_refused(self, auth_client, volunteer, project):
        response = auth_client(volunteer).post(LIST_URL, payload(project, amount="10.005"))
        assert response.status_code == 400

    def test_a_non_numeric_amount_is_refused(self, auth_client, volunteer, project):
        response = auth_client(volunteer).post(LIST_URL, payload(project, amount="about 500"))
        assert response.status_code == 400


class TestEditing:
    def test_the_submitter_can_edit_while_pending(self, auth_client, volunteer, project):
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        response = auth_client(volunteer).patch(
            detail_url(row), {"description": "Corrected: five volunteers."}
        )
        assert response.status_code == 200
        assert response.data["description"] == "Corrected: five volunteers."

    @pytest.mark.parametrize("actor", ["lead", "finance_lead", "exec_user"])
    def test_nobody_else_can_edit_it(self, request, auth_client, volunteer, project, actor):
        """No role overrides authorship, exec included.

        A claim is one person's statement of what they spent. A finance lead who
        could reword it could approve a claim its submitter never made.
        """
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        response = auth_client(request.getfixturevalue(actor)).patch(
            detail_url(row), {"title": "Rewritten"}
        )
        assert response.status_code == 403
        row.refresh_from_db()
        assert row.title != "Rewritten"

    @pytest.mark.parametrize("status", [ReimbursementStatus.APPROVED, ReimbursementStatus.REJECTED])
    def test_content_freezes_once_reviewed(self, auth_client, volunteer, project, status):
        """The rule that makes a decision mean something.

        An approval is an approval of specific content; a claim whose text can
        change after it is signed off is a signature on a blank page. Matters
        more once proof documents land than it does with two text fields today,
        which is why it is here now.
        """
        row = ReimbursementFactory(project=project, submitted_by=volunteer, status=status)
        response = auth_client(volunteer).patch(detail_url(row), {"title": "Actually more"})
        assert response.status_code == 403

    def test_the_submitter_can_correct_the_amount_while_pending(
        self, auth_client, volunteer, project
    ):
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        response = auth_client(volunteer).patch(detail_url(row), {"amount": "999.99"})
        assert response.status_code == 200
        assert response.data["amount"] == "999.99"

    def test_the_amount_freezes_with_everything_else_once_reviewed(
        self, auth_client, volunteer, project
    ):
        """The field the freeze exists for.

        Editing the title of an approved claim is untidy; editing the *amount*
        is claiming money nobody signed off. Same rule covers both, which is why
        the rule is about the request rather than about a field.
        """
        row = ReimbursementFactory(
            project=project,
            submitted_by=volunteer,
            amount=Decimal("100.00"),
            status=ReimbursementStatus.APPROVED,
        )
        response = auth_client(volunteer).patch(detail_url(row), {"amount": "10000.00"})
        assert response.status_code == 403
        row.refresh_from_db()
        assert row.amount == Decimal("100.00")

    def test_status_cannot_be_changed_through_the_ordinary_edit(
        self, auth_client, volunteer, project
    ):
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        response = auth_client(volunteer).patch(
            detail_url(row), {"status": ReimbursementStatus.APPROVED}
        )
        assert response.status_code == 200
        row.refresh_from_db()
        assert row.status == ReimbursementStatus.PENDING

    def test_a_request_cannot_be_moved_to_another_project(
        self, auth_client, exec_user, volunteer, project, other_project
    ):
        row = ReimbursementFactory(project=project, submitted_by=exec_user)
        response = auth_client(exec_user).patch(detail_url(row), {"project": other_project.pk})
        assert response.status_code == 400

    def test_a_dropped_member_stops_editing_what_they_filed(
        self, auth_client, project, semester, past_semester
    ):
        """Authorship is necessary but not sufficient — membership this term is
        the other half, as on the timeline.

        The past-term row is what keeps them able to *read* the request at all;
        without it the project leaves `visible_project_ids` and the row 404s
        before the write rule is reached. Which is also correct, and a duller
        test — this one is aimed at the term boundary specifically.
        """
        user = UserFactory(email=f"dropped@{CAMPUS}")
        MembershipFactory(user=user, project=project, semester=past_semester, role=Role.VOLUNTEER)
        membership = MembershipFactory(user=user, project=project, role=Role.VOLUNTEER)
        row = ReimbursementFactory(project=project, submitted_by=user)
        membership.delete()

        response = auth_client(user).patch(detail_url(row), {"title": "Still mine?"})
        assert response.status_code == 403

    def test_a_closed_term_is_frozen(self, auth_client, volunteer, project, past_semester):
        row = ReimbursementFactory(project=project, submitted_by=volunteer, semester=past_semester)
        response = auth_client(volunteer).patch(detail_url(row), {"title": "Reopened"})
        assert response.status_code == 403


class TestReviewing:
    def test_the_finance_lead_can_approve(self, auth_client, finance_lead, volunteer, project):
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        response = auth_client(finance_lead).post(
            review_url(row), {"status": ReimbursementStatus.APPROVED}
        )
        assert response.status_code == 200
        assert response.data["status"] == ReimbursementStatus.APPROVED
        assert response.data["reviewed_by"]["id"] == finance_lead.pk
        assert response.data["reviewed_at"] is not None

    def test_the_finance_lead_can_reject_with_a_reason(
        self, auth_client, finance_lead, volunteer, project
    ):
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        response = auth_client(finance_lead).post(
            review_url(row),
            {"status": ReimbursementStatus.REJECTED, "note": "No receipt attached."},
        )
        assert response.status_code == 200
        assert response.data["review_note"] == "No receipt attached."

    def test_a_rejection_must_say_why(self, auth_client, finance_lead, volunteer, project):
        """The one validation here about people rather than data.

        A claim turned down with no reason tells the volunteer nothing they can
        act on, and the next thing that happens is they refile it unchanged.
        """
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        response = auth_client(finance_lead).post(
            review_url(row), {"status": ReimbursementStatus.REJECTED, "note": "  "}
        )
        assert response.status_code == 400
        assert "note" in response.data

    def test_an_approval_needs_no_note(self, auth_client, finance_lead, volunteer, project):
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        response = auth_client(finance_lead).post(
            review_url(row), {"status": ReimbursementStatus.APPROVED}
        )
        assert response.status_code == 200

    def test_exec_can_review(self, auth_client, exec_user, volunteer, project):
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        response = auth_client(exec_user).post(
            review_url(row), {"status": ReimbursementStatus.APPROVED}
        )
        assert response.status_code == 200

    def test_a_plain_lead_cannot_review(self, auth_client, lead, volunteer, project):
        """The one place ``LEAD`` and ``FINANCE_LEAD`` come apart.

        The lead runs the project and sees the queue — they reach the row rather
        than 404ing on it — but signing it off is the finance lead's job.
        """
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        response = auth_client(lead).post(review_url(row), {"status": ReimbursementStatus.APPROVED})
        assert response.status_code == 403
        row.refresh_from_db()
        assert row.is_pending

    def test_a_volunteer_cannot_review_anyones(self, auth_client, volunteer, lead, project):
        row = ReimbursementFactory(project=project, submitted_by=lead)
        response = auth_client(volunteer).post(
            review_url(row), {"status": ReimbursementStatus.APPROVED}
        )
        # Not their row, so the queryset hides it first.
        assert response.status_code == 404

    def test_a_finance_lead_cannot_review_their_own(self, auth_client, finance_lead, project):
        """Separation of duties, the same shape as ``_assert_not_self``.

        A finance lead is exactly the sort of person who buys things for the
        project, so this is a live case rather than a theoretical one.
        """
        row = ReimbursementFactory(project=project, submitted_by=finance_lead)
        response = auth_client(finance_lead).post(
            review_url(row), {"status": ReimbursementStatus.APPROVED}
        )
        assert response.status_code == 403
        row.refresh_from_db()
        assert row.is_pending

    def test_exec_cannot_review_their_own_either(self, auth_client, exec_user, project):
        row = ReimbursementFactory(project=project, submitted_by=exec_user)
        response = auth_client(exec_user).post(
            review_url(row), {"status": ReimbursementStatus.APPROVED}
        )
        assert response.status_code == 403

    def test_a_second_finance_lead_can_review_the_first_ones_claim(
        self, auth_client, finance_lead, project, semester
    ):
        """The escape hatch the self rule leaves open, so it is not a dead end."""
        other = UserFactory(email=f"finance2@{CAMPUS}")
        MembershipFactory(user=other, project=project, semester=semester, role=Role.FINANCE_LEAD)
        row = ReimbursementFactory(project=project, submitted_by=finance_lead)

        response = auth_client(other).post(
            review_url(row), {"status": ReimbursementStatus.APPROVED}
        )
        assert response.status_code == 200

    def test_a_decision_can_be_changed_while_the_term_is_open(
        self, auth_client, finance_lead, volunteer, project
    ):
        """A wrong approval needs a way back that is not "ask exec".

        Re-stamping keeps the record of a decision having been made; deleting
        the claim, the only alternative, would lose it.
        """
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        client = auth_client(finance_lead)
        client.post(review_url(row), {"status": ReimbursementStatus.APPROVED})
        response = client.post(
            review_url(row),
            {"status": ReimbursementStatus.REJECTED, "note": "Approved the wrong row."},
        )
        assert response.status_code == 200
        assert response.data["status"] == ReimbursementStatus.REJECTED

    def test_a_request_cannot_be_set_back_to_pending(
        self, auth_client, finance_lead, volunteer, project
    ):
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        response = auth_client(finance_lead).post(
            review_url(row), {"status": ReimbursementStatus.PENDING}
        )
        assert response.status_code == 400

    def test_a_past_finance_lead_cannot_review(
        self, auth_client, volunteer, project, past_semester, semester
    ):
        stood_down = UserFactory(email=f"finance.past@{CAMPUS}")
        MembershipFactory(
            user=stood_down, project=project, semester=past_semester, role=Role.FINANCE_LEAD
        )
        row = ReimbursementFactory(project=project, submitted_by=volunteer)

        response = auth_client(stood_down).post(
            review_url(row), {"status": ReimbursementStatus.APPROVED}
        )
        # They are off this term's roster, so the queue is not theirs to read
        # either — hidden before it can be refused.
        assert response.status_code == 404

    def test_a_closed_term_cannot_be_reviewed(
        self, auth_client, finance_lead, volunteer, project, past_semester
    ):
        row = ReimbursementFactory(project=project, submitted_by=volunteer, semester=past_semester)
        response = auth_client(finance_lead).post(
            review_url(row), {"status": ReimbursementStatus.APPROVED}
        )
        assert response.status_code == 403


class TestRemoval:
    def test_the_submitter_can_withdraw_a_pending_request(self, auth_client, volunteer, project):
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        assert auth_client(volunteer).delete(detail_url(row)).status_code == 204

    def test_removal_is_soft(self, auth_client, volunteer, project):
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        auth_client(volunteer).delete(detail_url(row))
        row.refresh_from_db()
        assert row.is_deleted

    @pytest.mark.parametrize("actor", ["lead", "finance_lead", "exec_user"])
    def test_staff_can_remove_a_pending_request(
        self, request, auth_client, volunteer, project, actor
    ):
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        client = auth_client(request.getfixturevalue(actor))
        assert client.delete(detail_url(row)).status_code == 204

    def test_a_volunteer_cannot_withdraw_someone_elses(self, auth_client, volunteer, lead, project):
        row = ReimbursementFactory(project=project, submitted_by=lead)
        assert auth_client(volunteer).delete(detail_url(row)).status_code == 404

    @pytest.mark.parametrize("actor", ["volunteer", "lead", "finance_lead"])
    def test_a_reviewed_request_is_a_record_only_exec_can_remove(
        self, request, auth_client, volunteer, project, actor
    ):
        row = ReimbursementFactory(
            project=project, submitted_by=volunteer, status=ReimbursementStatus.APPROVED
        )
        client = auth_client(request.getfixturevalue(actor))
        assert client.delete(detail_url(row)).status_code == 403

    def test_exec_can_remove_a_settled_request(self, auth_client, exec_user, volunteer, project):
        row = ReimbursementFactory(
            project=project, submitted_by=volunteer, status=ReimbursementStatus.APPROVED
        )
        assert auth_client(exec_user).delete(detail_url(row)).status_code == 204

    def test_a_closed_term_cannot_be_pruned_by_staff(
        self, auth_client, finance_lead, volunteer, project, past_semester
    ):
        row = ReimbursementFactory(project=project, submitted_by=volunteer, semester=past_semester)
        assert auth_client(finance_lead).delete(detail_url(row)).status_code == 403

    def test_exec_keeps_the_lever_over_a_closed_term(
        self, auth_client, exec_user, volunteer, project, past_semester
    ):
        row = ReimbursementFactory(project=project, submitted_by=volunteer, semester=past_semester)
        assert auth_client(exec_user).delete(detail_url(row)).status_code == 204


class TestSemesterStamping:
    def test_the_term_is_derived_from_the_clock_not_a_date_field(self, project, semester):
        """Unlike a log, which reads ``occurred_on``. A claim is filed when it
        is filed."""
        row = ReimbursementFactory(project=project)
        assert row.semester_id == semester.pk

    def test_an_explicit_term_is_left_alone(self, project, past_semester):
        row = ReimbursementFactory(project=project, semester=past_semester)
        assert row.semester_id == past_semester.pk

    def test_pagination_reports_a_count(self, auth_client, finance_lead, volunteer, project):
        for _ in range(3):
            ReimbursementFactory(project=project, submitted_by=volunteer)
        response = auth_client(finance_lead).get(LIST_URL)
        assert response.data["count"] == 3


class TestPlaceholderRemoval:
    """`discard_placeholder_user` must know about the two PROTECT columns here.

    Both are unreachable in practice — filing needs a login and logging in
    claims the row — but an unguarded PROTECT surfaces as a 500 during an
    ordinary roster removal, which is the failure the whole guard exists to
    avoid.
    """

    def test_a_placeholder_who_filed_a_request_survives_removal(
        self, auth_client, lead, project, semester
    ):
        from apps.accounts.models import User

        placeholder = UserFactory(email=f"never.signed.in@{CAMPUS}", google_sub=None)
        membership = MembershipFactory(
            user=placeholder, project=project, semester=semester, role=Role.VOLUNTEER
        )
        ReimbursementFactory(project=project, submitted_by=placeholder)

        response = auth_client(lead).delete(
            reverse("membership-detail", kwargs={"pk": membership.pk})
        )
        assert response.status_code == 204
        assert User.objects.filter(pk=placeholder.pk).exists()

    def test_a_placeholder_who_reviewed_one_survives_removal(
        self, auth_client, exec_user, volunteer, project, semester
    ):
        from apps.accounts.models import User

        placeholder = UserFactory(email=f"phantom.finance@{CAMPUS}", google_sub=None)
        membership = MembershipFactory(
            user=placeholder, project=project, semester=semester, role=Role.FINANCE_LEAD
        )
        row = ReimbursementFactory(project=project, submitted_by=volunteer)
        row.record_decision(placeholder, ReimbursementStatus.APPROVED)

        response = auth_client(exec_user).delete(
            reverse("membership-detail", kwargs={"pk": membership.pk})
        )
        assert response.status_code == 204
        assert User.objects.filter(pk=placeholder.pk).exists()

    def test_a_soft_deleted_request_still_protects_its_submitter(
        self, auth_client, lead, project, semester
    ):
        from apps.accounts.models import User

        placeholder = UserFactory(email=f"withdrew@{CAMPUS}", google_sub=None)
        membership = MembershipFactory(
            user=placeholder, project=project, semester=semester, role=Role.VOLUNTEER
        )
        ReimbursementFactory(project=project, submitted_by=placeholder, is_deleted=True)

        auth_client(lead).delete(reverse("membership-detail", kwargs={"pk": membership.pk}))
        assert User.objects.filter(pk=placeholder.pk).exists()


class TestNoSemesterOnRecord:
    def test_filing_before_the_first_term_exists_is_a_400_not_a_500(
        self, auth_client, exec_user, project, semester
    ):
        """`Reimbursement.semester` is NOT NULL, so an unopened term has to be
        refused on the way in rather than blowing up on insert."""
        from apps.projects.models import Semester

        # Push every term into the future so `Semester.current()` finds none.
        Semester.objects.update(
            starts_on=datetime.date.today() + datetime.timedelta(days=30),
            ends_on=datetime.date.today() + datetime.timedelta(days=200),
        )
        response = auth_client(exec_user).post(LIST_URL, payload(project))
        assert response.status_code == 400
