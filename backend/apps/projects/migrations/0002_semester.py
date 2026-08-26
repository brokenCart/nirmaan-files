"""Introduce semesters, and give every existing row one.

The terms are reconstructed from the BITS calendar — Sem 1 runs August to
December, Sem 2 January to July, the second absorbing the summer so that no
date falls in a gap. Enough of them are created to cover the oldest entry on
record.

Rosters are the guess in here. There is no history of who was in a project
when, so each existing membership is copied into every term that ended after
the member joined. That is the best available approximation and it is a
starting point, not a fact: exec can correct any past roster afterwards, which
is why `MembershipViewSet` keeps that door open for them alone.
"""

import datetime

import django.db.models.deletion
from django.db import migrations, models
from django.utils.text import slugify

SEM1_START = datetime.date(1, 8, 1)  # month/day only; year is filled in below


def _term_containing(day: datetime.date) -> tuple[str, datetime.date, datetime.date]:
    """``(name, starts_on, ends_on)`` of the BITS term ``day`` falls in."""
    if day.month >= SEM1_START.month:
        start_year = day.year
        return (
            f"{start_year}-{(start_year + 1) % 100:02d} Sem 1",
            datetime.date(start_year, 8, 1),
            datetime.date(start_year, 12, 31),
        )
    start_year = day.year - 1
    return (
        f"{start_year}-{(start_year + 1) % 100:02d} Sem 2",
        datetime.date(day.year, 1, 1),
        datetime.date(day.year, 7, 31),
    )


def _month_starts(first: datetime.date, last: datetime.date):
    cursor = first.replace(day=1)
    while cursor <= last:
        yield cursor
        # Step to the 1st of the next month without a calendar dependency.
        cursor = (cursor.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)


def backfill(apps, schema_editor):
    Semester = apps.get_model("projects", "Semester")
    Membership = apps.get_model("projects", "Membership")
    DailyLog = apps.get_model("logs", "DailyLog")

    today = datetime.date.today()
    oldest = (
        DailyLog.objects.order_by("occurred_on").values_list("occurred_on", flat=True).first()
        or today
    )
    oldest = min(oldest, today)

    # One term per month covered, deduplicated by name. Always includes today's,
    # so a fresh install with no logs still comes out of this migration with a
    # current semester — without one, every write in the app would be denied.
    terms: dict[str, tuple[datetime.date, datetime.date]] = {}
    for month in _month_starts(oldest, today):
        name, starts_on, ends_on = _term_containing(month)
        terms[name] = (starts_on, ends_on)

    for name, (starts_on, ends_on) in terms.items():
        Semester.objects.get_or_create(
            name=name,
            defaults={"slug": slugify(name)[:80], "starts_on": starts_on, "ends_on": ends_on},
        )

    ordered = list(Semester.objects.order_by("starts_on"))
    if not ordered:
        return
    current = next((s for s in ordered if s.starts_on <= today <= s.ends_on), ordered[-1])

    clones = []
    for membership in Membership.objects.all():
        joined = membership.joined_at.date() if membership.joined_at else oldest
        membership.semester = current
        membership.save(update_fields=["semester"])
        for semester in ordered:
            if semester.pk == current.pk or semester.ends_on < joined:
                continue
            clones.append(
                Membership(
                    user_id=membership.user_id,
                    project_id=membership.project_id,
                    semester=semester,
                    role=membership.role,
                    is_active=membership.is_active,
                )
            )
    Membership.objects.bulk_create(clones, ignore_conflicts=True)


def unbackfill(apps, schema_editor):
    """Collapse back to one row per (user, project) so the old constraint holds."""
    Membership = apps.get_model("projects", "Membership")
    Semester = apps.get_model("projects", "Semester")

    seen = set()
    for membership in Membership.objects.order_by("-semester__starts_on"):
        key = (membership.user_id, membership.project_id)
        if key in seen:
            membership.delete()
        else:
            seen.add(key)
    Semester.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0001_initial"),
        # The backfill reads log dates to work out how far back the terms go.
        ("logs", "0002_remove_dailylog_location"),
    ]

    operations = [
        migrations.CreateModel(
            name="Semester",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("name", models.CharField(help_text='e.g. "2025-26 Sem 1".', max_length=60, unique=True)),
                ("slug", models.SlugField(blank=True, max_length=80, unique=True)),
                ("starts_on", models.DateField()),
                ("ends_on", models.DateField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["-starts_on"]},
        ),
        migrations.AddIndex(
            model_name="semester",
            index=models.Index(fields=["starts_on", "ends_on"], name="projects_se_starts__50d83a_idx"),
        ),
        migrations.AddConstraint(
            model_name="semester",
            constraint=models.CheckConstraint(
                condition=models.Q(ends_on__gt=models.F("starts_on")),
                name="semester_ends_after_it_starts",
            ),
        ),
        # Nullable first so existing rows survive the ALTER; filled in, then
        # tightened.
        migrations.AddField(
            model_name="membership",
            name="semester",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="memberships",
                to="projects.semester",
            ),
        ),
        migrations.RunPython(backfill, unbackfill),
        migrations.AlterField(
            model_name="membership",
            name="semester",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="memberships",
                to="projects.semester",
            ),
        ),
        # The old uniqueness is what forbade a second term's row; it has to go
        # before the new one can be added.
        migrations.RemoveConstraint(
            model_name="membership",
            name="unique_membership_per_user_project",
        ),
        migrations.AddConstraint(
            model_name="membership",
            constraint=models.UniqueConstraint(
                fields=("user", "project", "semester"),
                name="unique_membership_per_user_project_semester",
            ),
        ),
        migrations.RemoveIndex(
            model_name="membership",
            name="projects_me_project_5b7a94_idx",
        ),
        migrations.AddIndex(
            model_name="membership",
            index=models.Index(
                fields=["project", "semester", "role"], name="projects_me_project_9a7deb_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="membership",
            index=models.Index(fields=["user", "is_active"], name="projects_me_user_id_e8fee6_idx"),
        ),
    ]
