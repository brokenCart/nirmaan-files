"""Bulk-fill one project's timeline, to exercise paging by hand.

``seed_demo`` creates a handful of logs per project — enough for the role
matrix, not enough to page through. This tops a single project up.

Refuses to run outside DEBUG, for the same reason ``seed_demo`` does.
"""

import datetime
import itertools

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.logs.models import DailyLog, LogKind, LogStatus
from apps.projects.models import Membership, Project, Role

MOV_TITLES = [
    "Weekly session at the community centre",
    "Follow-up visit with the village school",
    "Distributed learning kits",
    "Parent outreach in the village",
    "Remedial reading circle",
]
MOM_TITLES = [
    "Weekly core team sync",
    "Budget review with finance",
    "Planning for the outreach drive",
    "Volunteer onboarding debrief",
    "Term retrospective",
]


class Command(BaseCommand):
    help = "Add sample daily logs to one project's timeline."

    def add_arguments(self, parser):
        parser.add_argument(
            "--project",
            default="shiksha",
            help="Project slug to fill (default: shiksha).",
        )
        parser.add_argument(
            "--count",
            type=int,
            default=60,
            help="How many logs to add (default: 60).",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_logs only runs with DEBUG=True.")

        slug: str = options["project"]
        count: int = options["count"]
        if count < 1:
            raise CommandError("--count must be at least 1.")

        try:
            project = Project.objects.get(slug=slug)
        except Project.DoesNotExist:
            known = ", ".join(Project.objects.values_list("slug", flat=True)) or "none"
            raise CommandError(f"No project with slug {slug!r}. Known slugs: {known}.") from None

        memberships = list(
            Membership.objects.filter(project=project).select_related("user").order_by("id")
        )
        if not memberships:
            raise CommandError(
                f"{project.name} has no members, so there is nobody to author logs. "
                "Run `seed_demo` first."
            )

        authors = [m.user for m in memberships]
        staff = [m.user for m in memberships if m.role in (Role.LEAD, Role.FINANCE_LEAD)]
        # MOMs read as staff-run meetings; fall back to the roster if a project
        # somehow has only volunteers.
        mom_authors = staff or authors

        before = DailyLog.objects.filter(project=project).count()

        # Start behind whatever seed_demo already laid down so the two sets do
        # not interleave on the same dates.
        today = datetime.date.today()
        oldest = (
            DailyLog.objects.filter(project=project)
            .order_by("occurred_on")
            .values_list("occurred_on", flat=True)
            .first()
        )
        start = min(today, oldest) if oldest else today

        author_cycle = itertools.cycle(authors)
        mom_cycle = itertools.cycle(mom_authors)
        created = 0

        for index in range(count):
            is_mom = index % 3 == 2
            titles = MOM_TITLES if is_mom else MOV_TITLES
            # The number keeps titles unique, which both makes get_or_create
            # idempotent across runs and makes it obvious which page you are on.
            title = f"{titles[index % len(titles)]} #{index + 1}"

            log, was_created = DailyLog.objects.get_or_create(
                project=project,
                title=title,
                defaults={
                    "kind": LogKind.MOM if is_mom else LogKind.MOV,
                    "body": (
                        "Agenda and decisions.\n\n1. Reviewed last week.\n2. Assigned owners."
                        if is_mom
                        else "Notes from the visit.\n\n"
                        "- Attendance was steady.\n- Follow up next week."
                    ),
                    # Two days apart, walking backwards from the existing feed.
                    "occurred_on": start - datetime.timedelta(days=(index + 1) * 2),
                    "author": next(mom_cycle) if is_mom else next(author_cycle),
                    "status": LogStatus.PUBLISHED,
                },
            )
            if was_created:
                created += 1
                log.attendees.set(self._attendees(log.author, authors))

        after = DailyLog.objects.filter(project=project).count()
        skipped = count - created
        note = f" ({skipped} already existed)" if skipped else ""
        self.stdout.write(
            self.style.SUCCESS(
                f"Added {created} logs to {project.name}{note}. "
                f"Timeline now holds {after} (was {before})."
            )
        )

    @staticmethod
    def _attendees(author: User, roster: list[User]) -> list[User]:
        others = [user for user in roster if user.pk != author.pk][:3]
        return [author, *others]
