# Managing a roster

Who may add, change and remove membership rows, and what removal takes with it.

Read alongside [AGENTS.md](../AGENTS.md), which carries the rules that apply to every
change in this repository — the per-project/per-semester role model above all.

`MembershipViewSet` is the write side of the roster, and `_assert_can_manage` is the rule: exec
bypasses, otherwise the caller must be `LEAD` **this term** and the row must belong to the open
term. A lead cannot touch a closed term at all — last term's roster is the record of who filed the
entries now sitting in the archive, so rewriting it would restate who was there.

**A lead hands out `VOLUNTEER` and nothing else** (`LEAD_ASSIGNABLE_ROLES`). Lead and finance lead
carry the money and the roster itself, so a lead who could name them could appoint their own
successor, or a second lead, with nobody above them in the loop. Exec appoints staff.

`_assert_can_manage` therefore takes **every role the write touches**, not just the new one:

- create — the role being granted, defaulting to `VOLUNTEER` when the field is omitted, since the
  model default would otherwise slip past the check unexamined;
- update — the row's current role *and* what it would become. Checking only the target would leave
  the rule one PATCH from moot (add a volunteer, then promote them); checking only the current role
  would let a lead demote the finance lead sitting beside them.
- destroy — the row's current role, so removing staff is exec's too. A lead can still remove a
  volunteer.

Being able to *see* a role is unaffected: the roster reads the same for everyone.

The SPA renders this in `ProjectMembersPanel` (the timeline's left rail), which shows an
**Add member** form when `canManageRoster` in `src/api/types.ts` says so. That predicate mirrors
`_assert_can_manage` and takes `isExec` **separately from `role`**, because `roleIn` reports a
project membership in preference to the committee marker — an exec who also volunteers on the
project comes back `VOLUNTEER`, and gating on `role === 'EXEC'` would hide a form the server would
have accepted. `assignableRoles` alongside it mirrors `LEAD_ASSIGNABLE_ROLES`, so a lead gets a
line of text where exec gets a picker — a `<select>` that cannot select anything reads as broken
rather than as a rule.

Two things the form does deliberately:

- **It posts `semester` explicitly** rather than letting the serializer default to the current
  term. Exec correcting a past roster is a supported case, and the default would silently retarget
  it. The rail is per-term already, so the term on screen is the term written to; the `all` view
  names no single term and falls back to the open one, which the submit button then labels.
- **It identifies the person by email, not id.** A lead can add someone who has never signed in;
  `MembershipSerializer.create` makes a placeholder user that is adopted on their first Google
  login by the `sub`-then-email match in `apps/accounts/services.py`.

The panel renders for a caller who can manage it even when the roster is **empty** — that is
exactly the term that needs building, and hiding the rail until someone is already on it would
leave a lead with no way in.

**Removing takes an unclaimed placeholder with it.** `perform_destroy` deletes the membership and
then calls `discard_placeholder_user` (`apps/projects/services.py`), which deletes the `User` row
only when it is genuinely disposable — otherwise a typo'd address leaves an account nobody can ever
claim. "Unclaimed" (`google_sub IS NULL`) is necessary but nowhere near sufficient, because
`Membership.user` is **CASCADE** and both log tables point at users. It refuses while the row still
has:

- **another membership** — the dangerous one. A placeholder on two projects, or carried into a past
  term, would vanish off a roster the caller has no authority over, and the archive would lose a
  member. One CASCADE, silently, across the project boundary the whole permission model exists to
  hold.
- **an authored entry** — `DailyLog.author` is PROTECT, so this raises rather than cascades.
  Unreachable in practice (filing needs a login, and logging in claims the row) but guarded rather
  than left to surface as a 500.
- **an attendance mark** — `DailyLog.attendees` is a plain M2M and drops silently, restating who
  was at a visit and moving the counts. A placeholder can absolutely be marked present: recording
  who turned up is *why* a lead adds someone before they sign in.
- **a resource they added** — `Resource.added_by` is PROTECT. Unreachable in practice for an
  unclaimed user, but an explicit guard turns a broken invariant into "keep the account" rather
  than a 500 during an ordinary roster removal.
- **anything in the knowledge base** — `Article.created_by`, `Article.updated_by` and
  `ArticleRevision.edited_by` are all PROTECT. The revision reference is normally the broad one,
  but all three are checked rather than relying on that invariant; soft-deleted pages count too,
  because their content and history deliberately remain in the database.
- **a reimbursement request they filed or reviewed** — `Reimbursement.submitted_by` and
  `reviewed_by` are both PROTECT. Unreachable in practice like the two above, and the reviewed
  case not even reachable in principle, but a settled claim is the last row whose names a
  financial record can afford to lose. Soft-deleted requests count, as removed pages do.

So the rule is "remove the roster row always, delete the account only when nothing is left pointing
at it". Removing is a hard delete, unlike a log — a roster row is a fact about the present term,
not a published account of something that happened.

`UserSerializer.has_signed_in` exposes `google_sub IS NOT NULL` as a boolean — the useful fact
without the identifier — so the SPA can word the confirmation honestly. It says the account is
*unclaimed*, not that it will definitely be deleted, because the server makes the final call.

**Nobody removes their own row** (`_assert_not_self`), exec included, and `is_active=False` counts
as removal — it drops the row from the roster, the attendance table and the member count exactly as
a DELETE does, so both hooks check it. Leaving is someone else's action: it keeps the only lead
from stranding a roster nobody can then manage, and an exec from quietly clearing themselves
mid-term. Only removal is blocked — editing your own row's *role* is not leaving.

For a lead this is belt and braces, since their own row is a `LEAD` row and the staff rule already
refuses it; the case the self rule actually adds is **exec**, who bypasses every other check.
Authority is asserted before selfhood, so someone with no business touching the roster still gets
the generic refusal rather than a hint about whose row it is.
