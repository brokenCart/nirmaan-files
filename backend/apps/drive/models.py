from django.db import models
from django.db.models import Q


class StoredImage(models.Model):
    """An image attached to a record. The bytes live in Drive; see `apps.drive.storage`.

    Soft-deleted like the records they belong to: removing one hides it in the
    app and leaves the file in Drive.
    """

    #: The route that serves this model's images. Part of what gets signed.
    content_url_name: str

    drive_file_id = models.CharField(max_length=512, unique=True)
    original_name = models.CharField(max_length=255)
    # Detected from the file's content when uploaded, never taken from the client.
    content_type = models.CharField(max_length=32)
    size_bytes = models.PositiveIntegerField()
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True
        ordering = ["created_at", "pk"]


class DriveFolder(models.Model):
    """A folder already created for a project, or for one term of a project.

    ``semester`` is null on the project's own folder and set on the per-term
    folders inside it. ``section`` is empty for photos and names a subtree, such
    as ``Receipts``, for anything that must be kept apart from them. Recorded
    here so an upload costs no folder lookups, and so renaming a project or term
    does not orphan what is already stored.
    """

    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="drive_folders"
    )
    semester = models.ForeignKey(
        "projects.Semester",
        on_delete=models.PROTECT,
        related_name="drive_folders",
        null=True,
        blank=True,
    )
    section = models.CharField(max_length=32, blank=True, default="")
    folder_id = models.CharField(max_length=512, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project", "semester", "section"],
                condition=Q(semester__isnull=False),
                name="one_drive_folder_per_project_term",
            ),
            models.UniqueConstraint(
                fields=["project", "section"],
                condition=Q(semester__isnull=True),
                name="one_root_drive_folder_per_project",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.project_id}/{self.semester_id or '-'}: {self.folder_id}"
