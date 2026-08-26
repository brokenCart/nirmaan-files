"""Populate a local database with enough data to exercise the role matrix by hand.

Refuses to run outside DEBUG: the accounts it creates have predictable emails
and unusable passwords, and none of them belong in a real deployment.
"""

import datetime
import random

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.logs.models import DailyLog, LogKind, LogStatus
from apps.projects.models import Membership, Project, Role

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
            DailyLog.objects.all().delete()
            Membership.objects.all().delete()
            Project.objects.filter(name__in=[name for name, _ in PROJECTS]).delete()
            User.objects.filter(email__endswith=f"@{CAMPUS}").exclude(is_superuser=True).delete()
            self.stdout.write("Cleared previous demo data.")

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

            self._member(lead, project, Role.LEAD)
            self._member(finance, project, Role.FINANCE_LEAD)
            for volunteer in volunteers:
                self._member(volunteer, project, Role.VOLUNTEER)

            # One person deliberately spans two projects with different roles —
            # the case the permission model exists for. Referenced by the loop
            # variable, not by a fresh query: Project.objects.first() orders by
            # name and would resolve to whichever project sorts first, which is
            # not necessarily the one seeded first.
            if index == 0:
                first_project_lead = lead
            elif index == 1 and first_project_lead is not None:
                self._member(first_project_lead, project, Role.VOLUNTEER)

            self._logs(project, lead, volunteers)

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {Project.objects.count()} projects, "
                f"{User.objects.count()} users, {DailyLog.objects.count()} logs.\n"
                f"Exec account: {exec_user.email}"
            )
        )

    def _user(self, handle: str, full_name: str, *, is_exec: bool = False) -> User:
        user, created = User.objects.get_or_create(
            email=f"{handle}@{CAMPUS}",
            defaults={"full_name": full_name, "is_exec": is_exec},
        )
        if created:
            user.set_unusable_password()  # sign-in is Google-only
            user.save(update_fields=["password"])
        return user

    def _member(self, user: User, project: Project, role: str) -> None:
        Membership.objects.get_or_create(user=user, project=project, defaults={"role": role})

    def _logs(self, project: Project, lead: User, volunteers: list[User]) -> None:
        today = datetime.date.today()

        for offset, title in enumerate(MOV_TITLES):
            log, created = DailyLog.objects.get_or_create(
                project=project,
                title=title,
                defaults={
                    "kind": LogKind.MOV,
                    "body": (
                        "Notes from the visit.\n\n- Attendance was steady.\n- Follow up next week."
                    ),
                    "occurred_on": today - datetime.timedelta(days=offset * 7 + 1),
                    "author": random.choice(volunteers),
                },
            )
            if created:
                log.attendees.set(random.sample(volunteers, min(2, len(volunteers))))

        for offset, title in enumerate(MOM_TITLES):
            log, created = DailyLog.objects.get_or_create(
                project=project,
                title=title,
                defaults={
                    "kind": LogKind.MOM,
                    "body": "Agenda and decisions.\n\n1. Reviewed last week.\n2. Assigned owners.",
                    "occurred_on": today - datetime.timedelta(days=offset * 7 + 3),
                    "author": lead,
                },
            )
            if created:
                log.attendees.set([lead, *volunteers])

        # One unpublished draft, to show that other members cannot see it.
        DailyLog.objects.get_or_create(
            project=project,
            title="Draft: notes I have not finished",
            defaults={
                "kind": LogKind.MOV,
                "body": "Half-written.",
                "occurred_on": today,
                "author": volunteers[0],
                "status": LogStatus.DRAFT,
            },
        )
