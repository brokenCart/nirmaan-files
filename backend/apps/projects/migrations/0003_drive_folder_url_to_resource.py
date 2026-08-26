"""Fold ``Project.drive_folder_url`` into the resource shelf.

The field predated `apps.resources` and was the one link a project could hold.
Now that a project can hold any number of them, a folder is just a `Resource`
with ``kind=FOLDER``, and keeping a second, special-cased place to put a Drive
URL means two screens to check and one of them invisible to the SPA.

The deferred media work named this field as its seam (see *Deferred: photos and
video* in ``CLAUDE.md``). The seam moves rather than disappears: that work now
looks up the project's ``FOLDER`` resource.

Existing values are carried across rather than dropped — one row per project
that had one.
"""

from django.conf import settings
from django.db import migrations

#: What the carried-over row is called. Only the forward pass uses it — see
#: `back_to_the_field` for why the reverse must not match on it.
FOLDER_TITLE = "Project Drive folder"


def to_resources(apps, schema_editor):
    """Turn each non-empty ``drive_folder_url`` into a ``FOLDER`` resource.

    ``Resource.added_by`` is NOT NULL, and nothing recorded who set the field,
    so the row has to be attributed to somebody. The project's most recent lead
    is the closest thing to the truth — setting the Drive folder was their job —
    with an exec as the fallback. **This is a guess**, in the same way the
    backfilled rosters in ``0002`` are: it says who would have done it, not who
    did.

    A project with nobody to attribute it to is skipped. Such a project has no
    members, so there is no one who could open the link either.
    """
    Project = apps.get_model("projects", "Project")
    Membership = apps.get_model("projects", "Membership")
    Resource = apps.get_model("resources", "Resource")
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))

    fallback = User.objects.filter(is_exec=True).order_by("pk").first()

    for project in Project.objects.exclude(drive_folder_url=""):
        # The shelf is unique on (project, url); a folder someone has already
        # added by hand wins, and this one is dropped rather than duplicated.
        if Resource.objects.filter(project=project, url=project.drive_folder_url).exists():
            continue

        # `pk` breaks the tie deliberately: `order_by` replaces the model's
        # Meta ordering, and a project with two leads in one term would
        # otherwise be attributed to whichever row the database happened to
        # return — a migration that gives two answers for the same data.
        memberships = Membership.objects.filter(project=project, is_active=True).order_by(
            "-semester__starts_on", "pk"
        )
        owner = memberships.filter(role="LEAD").first() or memberships.first()
        added_by_id = owner.user_id if owner is not None else getattr(fallback, "pk", None)
        if added_by_id is None:
            continue

        Resource.objects.create(
            project=project,
            kind="FOLDER",
            title=FOLDER_TITLE,
            url=project.drive_folder_url,
            description="",
            added_by_id=added_by_id,
        )


def back_to_the_field(apps, schema_editor):
    """Put a project's folder back on the re-added column, where it is obvious.

    Nothing marks which resource came from the field, so this cannot be an
    exact inverse. It restores only where there is no question — the project
    has **exactly one** ``FOLDER`` resource — and leaves the column blank where
    there are several, rather than writing back a folder that was never in the
    field. Matching on the title instead would look precise and be wrong the
    moment somebody names their own folder the same thing.

    Nothing is lost either way: the rows stay on the shelf, which is where the
    URLs now live. A blank column after a rollback is a copy-and-paste away
    from being filled, and a *wrong* one is not.

    The resource rows are deliberately left in place. They are valid on their
    own terms, and deleting them would take anything added since with them.
    """
    Project = apps.get_model("projects", "Project")
    Resource = apps.get_model("resources", "Resource")

    for project in Project.objects.all():
        folders = list(Resource.objects.filter(project=project, kind="FOLDER")[:2])
        if len(folders) == 1:
            Project.objects.filter(pk=project.pk).update(drive_folder_url=folders[0].url)


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0002_semester"),
        # The rows are written into the resources table, so it has to exist.
        ("resources", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(to_resources, back_to_the_field),
        migrations.RemoveField(model_name="project", name="drive_folder_url"),
    ]
