# Reimbursements

Volunteer money claims and the finance lead's review of them.

Read alongside [AGENTS.md](../AGENTS.md), which carries the rules that apply to every
change in this repository — the per-project/per-semester role model above all.

`apps.reimbursements.Reimbursement` is a volunteer's claim for money spent on the project, and the
decision made on it. `GET /api/reimbursements/?project=<slug>` is the queue, `POST
/api/reimbursements/<id>/review/` is the decision, and the SPA renders both at
`/projects/:slug/reimbursements`.

**Scoped to a semester**, like a log and unlike a resource or an article. The rubric is whether the
row records something that *happened on a date* or describes what *exists now*: a Drive folder is
the same folder it was last term, but a claim is an event, and the budget it comes out of restarts
each August with everything else this app counts. The term is derived from the **clock** at
creation rather than from a date field — there is no `occurred_on` here, because a log is written up
days after the visit while a request is filed when it is filed.

Three rules exist nowhere else in the codebase, and they are the module:

**A volunteer sees their own requests and nobody else's.** Every other list endpoint hands a member
everything in their project; this one is the first with a per-row read rule outside draft privacy,
because one member's spending is not another member's business. Leads and finance leads see the
whole queue. That inner set resolves against **this** term via `membership_roles` — the read/write
split applied to a *read*, and the one place where getting it wrong exposes other people's money
rather than a shared record everyone already reads. `visible_to` is where it lives, so a permission
class never has to hide a row.

**`FINANCE_LEAD` can do something `LEAD` cannot.** Until this module the two were synonyms —
`IsProjectStaff` covers both, and every write rule treats them alike. Approving and rejecting is the
finance lead's alone (`REVIEWER_ROLES`), while reading the queue is both roles' (`QUEUE_ROLES`):
running a project includes knowing what is claimed against it, signing it off is the finance lead's
actual job. A project with no finance lead this term is not stuck, since exec bypasses. If that
turns out to be the common case, adding `Role.LEAD` to `REVIEWER_ROLES` is the whole change — the
SPA's `canReviewReimbursement` mirrors it and would need the same one-line edit.

**Nobody reviews their own request, exec included.** Same shape as `_assert_not_self` on the roster,
and a live case rather than a theoretical one: a finance lead is exactly the sort of person who buys
things for the project. Their own claim goes to exec or to a second finance lead. Authority is
asserted before selfhood, so someone with no business reviewing gets the generic refusal rather than
a hint about whose row it is.

Two more things worth knowing:

- **Content freezes at the decision.** Only the submitter edits, only while `PENDING`, only in the
  open term, and no role overrides any of it. An approval is an approval of *specific content*, so a
  claim whose text can change after it is signed is a signature on a blank page. This matters far
  more once receipts land than it does today with two text fields, which is exactly why it is
  enforced now.
- **A rejection must carry a note**, enforced in `ReimbursementReviewSerializer.validate`. An
  approval need not — the money arriving is the message. A claim turned down with no reason gets
  refiled unchanged.

Reviewing is a `POST` to its own route rather than a `PATCH` of `status`, because the person allowed
to decide is precisely the person not allowed to edit; given separate endpoints the two rules sit
side by side instead of branching inside one handler on which field changed. `status` is read-only
on `ReimbursementSerializer`, so a request cannot be filed pre-approved. A decision **can** be
changed while the term is open (`record_decision` re-stamps reviewer and timestamp) — a wrong
approval needs a way back that is not "ask exec", and the only alternative, deleting the claim,
would lose the record of a decision having been made.

The SPA offers only the decisions that would *change* something: `availableDecisions` in
`api/types.ts` drops the request's current status, so an approved claim shows Reject alone and a
rejected one Approve alone, while a pending claim shows both. The API stays wider and still accepts
a review repeating the current status, which is what lets a reviewer amend a note without reversing
themselves — this is the UI declining to offer a no-op, not a rule the server enforces.

Deletes are **soft**, like a log's: the submitter withdraws while `PENDING`, staff clear the queue,
and once reviewed the row is a financial record only exec removes. Closed terms are frozen as on the
timeline, with exec keeping the moderation lever.

**`amount` is a `DecimalField`, never a float**, and DRF serializes it as a *string* — so the figure
survives the trip to the browser without passing through a binary fraction. `formatRupees` in
`lib/utils.ts` is the one place it becomes a `number`, immediately before rendering, and nothing is
computed from the result. Arithmetic happens on the server. There is **no currency column**: Nirmaan
is one campus spending rupees, and a second column nothing would ever set is worse than the
assumption written down. `MinValueValidator(0.01)` refuses zero and negatives — a claim for nothing
is a mistake, and a negative one is a refund this module does not model. Unlike the `URLField` case
on the resource shelf, DRF keeps a model `DecimalField`'s validators, so the column's rules *are*
the API's rules and `ReimbursementSerializer` restates none of them. (A `validate_amount` hook would
also never fire: field validators raise before `validate_<field>` is reached.)

`GET /api/reimbursements/summary/` returns a count **and a total** per status, under the same
visibility and term scope as the list. It exists because the list is **paginated**
(`ReimbursementPagination`, `page_size = 20`, mirrored by `REIMBURSEMENTS_PAGE_SIZE` in
`queries.ts`) — "₹4,200 awaiting review" must not become "₹1,800" on page two, and the totals are
what a finance lead actually opens the screen for. Unlike the shelf and the knowledge index this
list *is* paged, because those are bounded by a project's own tidiness and nobody prunes last
month's claims. The summary deliberately ignores `?status=`, since a count *per* status cannot
honour a filter *on* one. Its response is an inline object rather than a serializer, so the SPA
derives `ReimbursementSummary` from the generated `operations` type instead of hand-writing a
`Record`.

**Scope: no attachments.** Receipt images are the same unresolved Drive-quota problem that defers
photos on the timeline (see [*Deferred: photos and video*](deferred-media.md)), so when it is settled proof arrives as a
child table — `ReimbursementAttachment`, FK to the request, one row per file — rather than as a
field, because a claim carries several receipts and a child table can gain Drive ids without
touching this one. The freeze-on-review rule above is what makes that safe (it is the *amount* that
rule most exists to protect), and `submitted_by` is the account a Drive grant would be issued
against.
