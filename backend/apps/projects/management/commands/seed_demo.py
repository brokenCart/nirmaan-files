"""Populate a local database with enough data to exercise the role matrix by hand.

Refuses to run outside DEBUG: the accounts it creates have predictable emails
and unusable passwords, and none of them belong in a real deployment.
"""

import datetime
import random
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.knowledge.models import Article, ArticleCategory
from apps.logs.models import DailyLog, LogKind, LogStatus
from apps.projects.models import Membership, Project, Role, Semester
from apps.reimbursements.models import Reimbursement, ReimbursementStatus
from apps.resources.models import Resource, ResourceKind

CAMPUS = "pilani.bits-pilani.ac.in"

PROJECTS = [
    ("Shiksha", "After-school teaching for children in nearby villages."),
    ("Aarogya", "Community health camps and awareness drives."),
    ("Srijan", "Livelihood and skill-building workshops for women."),
]

MOV_TITLES = [
    "Weekly session at the community centre",
    "Follow-up visit with the village school",
    "Distributed learning kits",
]
MOM_TITLES = [
    "Weekly core team sync",
    "Budget review with finance",
    "Planning for the outreach drive",
]

# The shelf every project gets. Not semester-scoped, so one set per project is
# the whole of it — see `apps.resources.models.Resource`.
RESOURCES = [
    (ResourceKind.FOLDER, "Project Drive folder", "Photos, reports and consent forms."),
    (ResourceKind.DOCUMENT, "Semester plan", "Sessions, milestones and who owns what."),
    (ResourceKind.SHEET, "Beneficiary list", "Names and attendance at the centre."),
    (ResourceKind.FORM, "Volunteer feedback form", "Filled in after every visit."),
]


# The knowledge base every project gets. Like the shelf, not semester-scoped —
# an article states what is true now, so one set per project is the whole of it.
#
# The first entry is written by the *alumnus* and then revised by the current
# lead, which is the module demonstrated in one row: the person who knew it has
# graduated, the knowledge has not, and the history says who changed what.
ARTICLES = [
    (
        "alumnus",
        ArticleCategory.CONTEXT,
        "How this project started",
        "We began in 2019 after a survey of four villages around campus found that the "
        "nearest secondary school was eleven kilometres away. The first batch ran two "
        "sessions a week out of a borrowed room at the panchayat office.",
        "Corrected the founding year and added the panchayat detail.",
    ),
    (
        "lead",
        ArticleCategory.PROCESS,
        "Running a Saturday session",
        "The bus leaves the main gate at 08:00 sharp and will not wait. Sign the register "
        "at the centre before starting. Sessions run 09:00-12:00 with a break at 10:30. "
        "File the MOV the same evening while you still remember the names.",
        "",
    ),
    (
        "lead",
        ArticleCategory.PARTNER,
        "Who to call",
        "Sunita ma'am runs the centre and is the first point of contact for anything on "
        "the ground. The block education officer signs off on the annual permission "
        "letter; start that a month early, it is never quick.",
        "",
    ),
    (
        "volunteer",
        ArticleCategory.LESSON,
        "What we got wrong last year",
        "We scheduled the exam-prep drive during the harvest and attendance halved. "
        "Check the agricultural calendar before fixing dates, not after.",
        "",
    ),
]


# One reimbursement request per state, so the finance lead's queue has
# something in each tab and the freeze-on-review rule is visible by hand: the
# approved and rejected rows refuse an edit, the pending one accepts it.
#
# The last entry is the finance lead's *own* claim, left pending on purpose —
# it is the row they cannot review themselves, which is the separation-of-duties
# rule you would otherwise have to read the source to discover.
REIMBURSEMENTS = [
    (
        "volunteer",
        "Bus fare for the Saturday visit",
        Decimal("480.00"),
        "Four volunteers, return tickets to the centre and back. Receipts with me.",
        ReimbursementStatus.APPROVED,
        "",
    ),
    (
        "volunteer",
        "Chart paper and markers",
        Decimal("1250.00"),
        "Stationery for the exam-prep drive, bought at the market outside campus.",
        ReimbursementStatus.REJECTED,
        "Stationery comes out of the centre's own budget — claim it from Sunita ma'am.",
    ),
    (
        "lead",
        "Printing for the parent meeting",
        Decimal("2100.00"),
        "Sixty handouts and two banners for the parents' session on the 14th.",
        ReimbursementStatus.PENDING,
        "",
    ),
    (
        "finance",
        "Auto to the block education office",
        Decimal("260.00"),
        "Dropped the permission letter off in person after the post went missing.",
        ReimbursementStatus.PENDING,
        "",
    ),
]


class Command(BaseCommand):
    help = "Create demo projects, users in every role, and sample logs."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete existing demo rows before seeding.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_demo only runs with DEBUG=True.")

        random.seed(0)

        if options["reset"]:
            # Resources and articles first: `added_by`, `created_by` and
            # `ArticleRevision.edited_by` are all PROTECT, so they have to go
            # before the demo accounts behind them. Deleting an article takes
            # its revisions with it.
            Resource.objects.all().delete()
            Article.objects.all().delete()
            Reimbursement.objects.all().delete()
            DailyLog.objects.all().delete()
            Membership.objects.all().delete()
            Semester.objects.all().delete()
            Project.objects.filter(name__in=[name for name, _ in PROJECTS]).delete()
            User.objects.filter(email__endswith=f"@{CAMPUS}").exclude(is_superuser=True).delete()
            self.stdout.write("Cleared previous demo data.")

        past, current = self._semesters()

        exec_user = self._user("exec.member", "Ananya (Exec Committee)", is_exec=True)

        first_project_lead: User | None = None

        for index, (name, description) in enumerate(PROJECTS):
            project, _ = Project.objects.get_or_create(
                name=name, defaults={"description": description}
            )

            lead = self._user(f"lead.{project.slug}", f"Lead of {name}")
            finance = self._user(f"finance.{project.slug}", f"Finance Lead of {name}")
            volunteers = [
                self._user(f"volunteer{n}.{project.slug}", f"Volunteer {n} of {name}")
                for n in (1, 2)
            ]

            self._member(lead, project, current, Role.LEAD)
            self._member(finance, project, current, Role.FINANCE_LEAD)
            for volunteer in volunteers:
                self._member(volunteer, project, current, Role.VOLUNTEER)

            # Last term's roster differs, which is the point of the archive:
            # this term's lead was a volunteer then, and someone who has since
            # graduated led it and kept read-only access to what they wrote.
            alumnus = self._user(f"alumnus.{project.slug}", f"Former Lead of {name}")
            self._member(alumnus, project, past, Role.LEAD)
            self._member(lead, project, past, Role.VOLUNTEER)
            self._member(volunteers[0], project, past, Role.VOLUNTEER)

            # One person deliberately spans two projects with different roles —
            # the case the permission model exists for. Referenced by the loop
            # variable, not by a fresh query: Project.objects.first() orders by
            # name and would resolve to whichever project sorts first, which is
            # not necessarily the one seeded first.
            if index == 0:
                first_project_lead = lead
            elif index == 1 and first_project_lead is not None:
                self._member(first_project_lead, project, current, Role.VOLUNTEER)

            self._logs(project, lead, volunteers)
            self._logs(project, alumnus, [alumnus, volunteers[0]], semester=past)
            self._resources(project, lead)
            self._articles(project, {"lead": lead, "alumnus": alumnus, "volunteer": volunteers[0]})
            self._reimbursements(
                project,
                {"lead": lead, "finance": finance, "volunteer": volunteers[0]},
                finance,
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {Semester.objects.count()} semesters, {Project.objects.count()} projects, "
                f"{User.objects.count()} users, {DailyLog.objects.count()} logs, "
                f"{Resource.objects.count()} resource links, "
                f"{Article.objects.count()} knowledge pages, "
                f"{Reimbursement.objects.count()} reimbursement requests.\n"
                f"Exec account: {exec_user.email}"
            )
        )

    def _semesters(self) -> tuple[Semester, Semester]:
        """One closed term and one open one, so the archive has something in it."""
        today = datetime.date.today()
        current, _ = Semester.objects.get_or_create(
            name="2026-27 Sem 1",
            defaults={
                "starts_on": today - datetime.timedelta(days=30),
                "ends_on": today + datetime.timedelta(days=120),
            },
        )
        past, _ = Semester.objects.get_or_create(
            name="2025-26 Sem 2",
            defaults={
                "starts_on": current.starts_on - datetime.timedelta(days=210),
                "ends_on": current.starts_on - datetime.timedelta(days=1),
            },
        )
        return past, current

    def _user(self, handle: str, full_name: str, *, is_exec: bool = False) -> User:
        user, created = User.objects.get_or_create(
            email=f"{handle}@{CAMPUS}",
            defaults={"full_name": full_name, "is_exec": is_exec},
        )
        if created:
            user.set_unusable_password()  # sign-in is Google-only
            user.save(update_fields=["password"])
        return user

    def _member(self, user: User, project: Project, semester: Semester, role: str) -> None:
        Membership.objects.get_or_create(
            user=user, project=project, semester=semester, defaults={"role": role}
        )

    def _resources(self, project: Project, lead: User) -> None:
        """A handful of links per project.

        The URLs are fabricated but well-formed, and unique per project — the
        model refuses the same link twice on one shelf.
        """
        for kind, title, description in RESOURCES:
            Resource.objects.get_or_create(
                project=project,
                url=f"https://drive.google.com/drive/folders/{project.slug}-{kind.lower()}",
                defaults={
                    "kind": kind,
                    "title": title,
                    "description": description,
                    "added_by": lead,
                },
            )

    def _articles(self, project: Project, authors: dict[str, User]) -> None:
        """A small knowledge base per project, with history behind it.

        Goes through `record_revision` rather than writing `ArticleRevision`
        rows directly, so the seeded data is shaped by the same code the API
        uses — a page with no history would be a state the app cannot produce.
        """
        for handle, category, title, body, note in ARTICLES:
            author = authors[handle]
            article, created = Article.objects.get_or_create(
                project=project,
                title=title,
                defaults={
                    "category": category,
                    "body": body,
                    "created_by": author,
                    "updated_by": author,
                },
            )
            if not created:
                continue
            article.record_revision(author)

            # A second version for the page whose author has since graduated:
            # the current lead corrects it, and the trail shows both.
            if note:
                article.body = f"{body} The room is ours outright now."
                article.save(update_fields=["body"])
                article.record_revision(authors["lead"], note=note)

    def _reimbursements(self, project: Project, authors: dict[str, User], finance: User) -> None:
        """A queue per project, with one request in each state.

        Decisions go through `record_decision` rather than being written as
        fields, so the seeded rows carry a reviewer and a timestamp exactly as
        an API review leaves them — a settled request with no reviewer on it is
        a state the app cannot produce.

        The finance lead signs everything here except their own claim, which is
        left pending because the API would refuse it and the demo should not
        show a state the rules forbid.
        """
        for handle, title, amount, description, status, note in REIMBURSEMENTS:
            request, created = Reimbursement.objects.get_or_create(
                project=project,
                title=title,
                defaults={
                    "amount": amount,
                    "description": description,
                    "submitted_by": authors[handle],
                },
            )
            if created and status != ReimbursementStatus.PENDING:
                request.record_decision(finance, status=status, note=note)

    def _logs(
        self,
        project: Project,
        lead: User,
        volunteers: list[User],
        *,
        semester: Semester | None = None,
    ) -> None:
        # Entries are dated inside their term and `DailyLog.save` reads the date
        # to file them, so an anchor near the end of the term keeps a few weeks
        # of history from spilling out the back of it.
        anchor = min(datetime.date.today(), semester.ends_on) if semester else datetime.date.today()
        suffix = f" ({semester.name})" if semester else ""

        for offset, title in enumerate(MOV_TITLES):
            log, created = DailyLog.objects.get_or_create(
                project=project,
                title=f"{title}{suffix}",
                defaults={
                    "kind": LogKind.MOV,
                    "body": (
                        "Notes from the visit.\n\n- Attendance was steady.\n- Follow up next week."
                    ),
                    "occurred_on": anchor - datetime.timedelta(days=offset * 7 + 1),
                    "author": random.choice(volunteers),
                },
            )
            if created:
                log.attendees.set(random.sample(volunteers, min(2, len(volunteers))))

        for offset, title in enumerate(MOM_TITLES):
            log, created = DailyLog.objects.get_or_create(
                project=project,
                title=f"{title}{suffix}",
                defaults={
                    "kind": LogKind.MOM,
                    "body": "Agenda and decisions.\n\n1. Reviewed last week.\n2. Assigned owners.",
                    "occurred_on": anchor - datetime.timedelta(days=offset * 7 + 3),
                    "author": lead,
                },
            )
            if created:
                log.attendees.set([lead, *volunteers])

        # One unpublished draft, to show that other members cannot see it.
        DailyLog.objects.get_or_create(
            project=project,
            title=f"Draft: notes I have not finished{suffix}",
            defaults={
                "kind": LogKind.MOV,
                "body": "Half-written.",
                "occurred_on": anchor,
                "author": volunteers[0],
                "status": LogStatus.DRAFT,
            },
        )
