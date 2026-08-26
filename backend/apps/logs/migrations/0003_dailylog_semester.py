"""Stamp every entry with the term its date falls in.

Runs after `projects.0002_semester`, which has already created enough terms to
cover the oldest entry, so every row here resolves. An entry whose date lands
in a gap takes the term that most recently ended before it, matching
`Semester.for_date`.
"""

import django.db.models.deletion
from django.db import migrations, models


def stamp(apps, schema_editor):
    Semester = apps.get_model("projects", "Semester")
    DailyLog = apps.get_model("logs", "DailyLog")

    terms = list(Semester.objects.order_by("starts_on"))
    if not terms:
        return

    def resolve(day):
        containing = next((t for t in terms if t.starts_on <= day <= t.ends_on), None)
        if containing is not None:
            return containing
        earlier = [t for t in terms if t.ends_on < day]
        # Before every term on record: the oldest is the only sane home for it.
        return earlier[-1] if earlier else terms[0]

    updates = []
    for log in DailyLog.objects.all().only("pk", "occurred_on"):
        log.semester = resolve(log.occurred_on)
        updates.append(log)
    DailyLog.objects.bulk_update(updates, ["semester"], batch_size=500)


class Migration(migrations.Migration):
    dependencies = [
        ("logs", "0002_remove_dailylog_location"),
        ("projects", "0002_semester"),
    ]

    operations = [
        migrations.AddField(
            model_name="dailylog",
            name="semester",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="logs",
                to="projects.semester",
            ),
        ),
        migrations.RunPython(stamp, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="dailylog",
            name="semester",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="logs",
                to="projects.semester",
            ),
        ),
        migrations.AddIndex(
            model_name="dailylog",
            index=models.Index(
                fields=["project", "semester", "-occurred_on"], name="logs_dailyl_project_bb5938_idx"
            ),
        ),
    ]
