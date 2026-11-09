import datetime

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_GET
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.drive.images import (
    MAX_IMAGES_PER_OWNER,
    ImageUploadSerializer,
    attach_image,
    serve_image,
)
from apps.drive.video import (
    MAX_VIDEOS_PER_OWNER,
    VideoChunkSerializer,
    VideoUploadStartSerializer,
    VideoUploadStateSerializer,
    receive_chunk,
    serve_video,
    start_upload,
)
from apps.projects.models import Project, Role, Semester
from apps.projects.permissions import IsProjectMember, current_semester, role_in_project

from .models import DailyLog, LogImage, LogVideo, LogVideoStatus
from .pagination import DailyLogPagination
from .serializers import DailyLogSerializer, LogImageSerializer

FEED_PARAMS = [
    OpenApiParameter(name="project", description="Project slug.", required=False, type=str),
    OpenApiParameter(name="kind", description="MOV or MOM.", required=False, type=str),
    OpenApiParameter(
        name="semester",
        description="Semester slug, or `all`. Defaults to the open term.",
        required=False,
        type=str,
    ),
    OpenApiParameter(
        name="q",
        description="Free-text match over title, body, author and attendees.",
        required=False,
        type=str,
    ),
]


def _matches(search: str) -> Q:
    """Entries whose text, author or attendees mention `search`.

    A plain ILIKE, as in the knowledge base: a project files a few hundred
    entries a year, which a sequential scan handles for free.

    Attendees match through a subquery on the primary key rather than a join,
    because joining the M2M would return an entry once per matching attendee
    and break the page counts.
    """
    people = Q(attendees__full_name__icontains=search) | Q(attendees__email__icontains=search)
    return (
        Q(title__icontains=search)
        | Q(body__icontains=search)
        | Q(author__full_name__icontains=search)
        | Q(author__email__icontains=search)
        | Q(pk__in=DailyLog.objects.filter(people).values("pk"))
    )


@extend_schema_view(list=extend_schema(parameters=FEED_PARAMS))
class DailyLogViewSet(viewsets.ModelViewSet):
    """MOV and MOM entries on a project timeline.

    Write rules:
      * any member of the project **this semester** may file a log;
      * only its **author**, and only while still a member this semester, may
        edit one — including after publishing, and including against leads and
        exec, who get no edit rights at all;
      * leads, finance leads and exec may delete any log in their project, and
        an author may delete their own;
      * a closed semester is frozen. Entries in a past term cannot be edited by
        anyone, and only exec can remove one.

    An entry is one person's account of what happened, so staff who disagree
    with it remove it rather than reword it under the author's name. Deletes
    are soft, which is what makes that safe.

    Reading is wider than writing: anyone who has ever been a member sees the
    whole archive. Filing against it is what stops at the term boundary.
    """

    serializer_class = DailyLogSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    pagination_class = DailyLogPagination
    # Schema introspection only; get_queryset() is what actually runs.
    queryset = DailyLog.objects.none()

    def get_queryset(self):
        qs = (
            DailyLog.objects.visible_to(self.request)
            .select_related("project", "author", "semester")
            .prefetch_related("attendees", "images", "videos")
        )
        params = self.request.query_params
        if project_slug := params.get("project"):
            qs = qs.filter(project__slug=project_slug)
        if kind := params.get("kind"):
            qs = qs.filter(kind=kind)
        if since := params.get("since"):
            qs = qs.filter(occurred_on__gte=since)
        if until := params.get("until"):
            qs = qs.filter(occurred_on__lte=until)
        if search := params.get("q", "").strip():
            qs = qs.filter(_matches(search))

        # Scoping to a term is a property of the *feed*, not of an entry. A
        # detail route must reach an archived entry by its own URL — otherwise
        # every 403 the frozen-archive rule is meant to return arrives as a 404
        # instead, and the SPA cannot open a permalink into last year.
        if self.action != "list":
            return qs

        # `semester=all` reads across every term; an explicit slug reads one;
        # the default is the term in progress, so the timeline does not open on
        # three years of history.
        semester = params.get("semester")
        if semester == "all":
            return qs
        if semester:
            return qs.filter(semester__slug=semester)
        current = current_semester(self.request)
        return qs.filter(semester=current) if current else qs.none()

    def _open_semester(self) -> Semester:
        current = current_semester(self.request)
        if current is None:
            raise ValidationError(
                "No semester has been created yet. Ask the Executive Committee to open the term."
            )
        return current

    def _assert_can_create(self, project: Project, occurred_on) -> None:
        current = self._open_semester()
        if self.request.user.is_exec:
            return
        if role_in_project(self.request, project.pk) is None:
            raise PermissionDenied(
                "You are not a member of this project this semester. "
                "You can read its archive but not add to it."
            )
        # Backdating far enough would file a fresh entry straight into a closed
        # term, which is the frozen-archive rule with an extra step.
        landing = Semester.for_date(occurred_on)
        if landing is not None and landing.pk != current.pk:
            raise PermissionDenied(
                f"That date falls in {landing}, which has ended. "
                "Ask the Executive Committee to add it."
            )

    def _assert_is_open(self, instance: DailyLog) -> None:
        """Refuse to touch an entry that belongs to a closed term."""
        current = current_semester(self.request)
        if current is None or instance.semester_id != current.pk:
            raise PermissionDenied(
                f"{instance.semester} has ended. Entries in a past semester are part of "
                "the record and cannot be changed."
            )

    def _assert_can_edit(self, instance: DailyLog) -> None:
        # Two gates, then authorship. The term check runs first so a past member
        # editing an old entry is told the archive is closed rather than that
        # they are the author.
        self._assert_is_open(instance)

        # Membership is *not* established upstream: `visible_to` scopes to any
        # semester, so someone dropped from this term's roster still reads the
        # feed — and would otherwise keep editing the entries they filed while
        # they were on it. Write access ends with the membership, which is the
        # same rule `_assert_can_create` and `_assert_can_delete` apply.
        user = self.request.user
        if not user.is_exec and role_in_project(self.request, instance.project_id) is None:
            raise PermissionDenied(
                "You are not a member of this project this semester. "
                "You can read the timeline but no longer change it."
            )

        # Authorship is the rest of the rule — no role grants an edit, exec
        # included.
        if instance.author_id != self.request.user.pk:
            raise PermissionDenied(
                "Only the author can edit this entry. Ask a project lead to remove it instead."
            )

    def _assert_can_delete(self, instance: DailyLog) -> None:
        user = self.request.user
        if user.is_exec:
            # Exec keeps the moderation lever over the archive: something that
            # should never have been published must still be removable a year
            # on. The delete is soft, so this hides the entry, not the history.
            return

        self._assert_is_open(instance)

        role = role_in_project(self.request, instance.project_id)
        if role is None:
            raise PermissionDenied("You are not a member of this project this semester.")
        if role in (Role.LEAD, Role.FINANCE_LEAD):
            return
        if instance.author_id != user.pk:
            raise PermissionDenied("Volunteers can only delete their own entries.")

    def perform_create(self, serializer):
        project = serializer.validated_data.get("project")
        if project is None:
            raise ValidationError({"project": "This field is required."})
        self._assert_can_create(project, serializer.validated_data["occurred_on"])
        serializer.save(author=self.request.user)

    def _assert_stays_in_term(self, instance: DailyLog, occurred_on) -> None:
        """Refuse a date change that would carry an entry out of its semester.

        Exec included, unlike filing a new entry: the frozen-archive rule says a
        closed term stops changing, and an entry's photos are already stored in
        its current term's folder.
        """
        if occurred_on == instance.occurred_on:
            return
        landing = Semester.for_date(occurred_on)
        if landing is not None and landing.pk != instance.semester_id:
            raise PermissionDenied(
                f"That date falls in {landing}. An entry cannot be moved to another semester."
            )

    def perform_update(self, serializer):
        self._assert_can_edit(serializer.instance)
        self._assert_stays_in_term(
            serializer.instance,
            serializer.validated_data.get("occurred_on", serializer.instance.occurred_on),
        )
        serializer.save()

    def perform_destroy(self, instance):
        self._assert_can_delete(instance)
        # Soft delete: the timeline is the project's institutional memory.
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted"])

    @extend_schema(
        request={"multipart/form-data": ImageUploadSerializer},
        responses={201: LogImageSerializer},
    )
    @action(detail=True, methods=["post"], url_path="images", parser_classes=[MultiPartParser])
    def add_image(self, request, pk=None):
        """Attach one photo. Adding to an entry is editing it, so the edit rule applies."""
        log = self.get_object()
        self._assert_can_edit(log)

        image = attach_image(
            LogImage,
            request.data,
            existing=len(log.live_images),
            limit_message=f"An entry can hold {MAX_IMAGES_PER_OWNER} images.",
            project=log.project,
            semester=log.semester,
            label=f"{log.occurred_on} {log.kind} {log.title[:60]}",
            owner={"log": log},
        )
        return Response(LogImageSerializer(image).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        request=None,
        responses={204: None},
        parameters=[OpenApiParameter("image_id", int, OpenApiParameter.PATH)],
    )
    @action(detail=True, methods=["delete"], url_path=r"images/(?P<image_id>\d+)")
    def remove_image(self, request, pk=None, image_id=None):
        """Remove one photo from the entry, under the same edit rule."""
        log = self.get_object()
        self._assert_can_edit(log)
        image = get_object_or_404(log.images.all(), pk=image_id, is_deleted=False)
        image.is_deleted = True
        image.save(update_fields=["is_deleted"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=VideoUploadStartSerializer, responses={201: VideoUploadStateSerializer})
    @action(detail=True, methods=["post"], url_path="videos")
    def start_video(self, request, pk=None):
        """Open an upload for one video. The chunks follow separately."""
        log = self.get_object()
        self._assert_can_edit(log)
        # Recent unfinished uploads count, or several at once would all pass.
        # Old ones do not, so an abandoned upload cannot use up the limit.
        day_ago = timezone.now() - datetime.timedelta(days=1)
        video = start_upload(
            LogVideo,
            request.data,
            existing=log.videos.filter(is_deleted=False)
            .filter(Q(status=LogVideoStatus.READY) | Q(created_at__gte=day_ago))
            .count(),
            limit_message=f"An entry can hold {MAX_VIDEOS_PER_OWNER} videos.",
            project=log.project,
            semester=log.semester,
            label=f"{log.occurred_on} {log.kind} {log.title[:60]}",
            owner={"log": log},
        )
        return Response(VideoUploadStateSerializer(video).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        request={"multipart/form-data": VideoChunkSerializer},
        responses={200: VideoUploadStateSerializer},
        parameters=[OpenApiParameter("video_id", int, OpenApiParameter.PATH)],
    )
    @action(
        detail=True,
        methods=["post"],
        url_path=r"videos/(?P<video_id>\d+)/chunk",
        parser_classes=[MultiPartParser],
    )
    def video_chunk(self, request, pk=None, video_id=None):
        """Add one chunk. The response says how far the upload has really got."""
        log = self.get_object()
        self._assert_can_edit(log)
        video = receive_chunk(log.videos.all(), video_id, request.data)
        return Response(VideoUploadStateSerializer(video).data)

    @extend_schema(
        request=None,
        responses={204: None},
        parameters=[OpenApiParameter("video_id", int, OpenApiParameter.PATH)],
    )
    @action(detail=True, methods=["delete"], url_path=r"videos/(?P<video_id>\d+)")
    def remove_video(self, request, pk=None, video_id=None):
        """Remove one video from the entry, under the same edit rule."""
        log = self.get_object()
        self._assert_can_edit(log)
        video = get_object_or_404(log.videos.all(), pk=video_id, is_deleted=False)
        video.is_deleted = True
        video.save(update_fields=["is_deleted"])
        return Response(status=status.HTTP_204_NO_CONTENT)


@require_GET
def log_image_content(request, pk: int):
    return serve_image(
        request, pk, LogImage.objects.filter(is_deleted=False, log__is_deleted=False)
    )


@require_GET
def log_video_content(request, pk: int):
    return serve_video(
        request,
        pk,
        LogVideo.objects.filter(
            is_deleted=False, status=LogVideoStatus.READY, log__is_deleted=False
        ),
    )
