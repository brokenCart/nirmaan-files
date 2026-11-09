"""Receiving videos in pieces and streaming them back.

The browser sends a video in chunks, and the backend relays each to a resumable
Drive session. No request is long or memory-heavy, the Drive session URL never
reaches the browser, and every chunk is authorised like any other edit.
"""

import re
import uuid
from pathlib import PurePath

from django.db import transaction
from django.http import Http404, HttpResponse, HttpResponseForbidden, StreamingHttpResponse
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from .images import (
    CACHE_SECONDS,
    THUMBNAIL_PIXELS,
    ImageStorageUnavailable,
    content_url,
    is_valid_signature,
)
from .storage import StorageError, get_storage, semester_folder

MAX_VIDEO_BYTES = 500 * 1024 * 1024
MAX_VIDEOS_PER_OWNER = 3
CHUNK_BYTES = 8 * 1024 * 1024
# Drive requires every chunk except the last to be a multiple of this.
CHUNK_UNIT_BYTES = 256 * 1024
EXTENSIONS = {"video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm"}

_RANGE = re.compile(r"^bytes=\d*-\d*$")
_MP4_BOX_TYPES = {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip"}


class VideoUploadStartSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    size = serializers.IntegerField(
        min_value=1,
        max_value=MAX_VIDEO_BYTES,
        error_messages={"max_value": f"Videos can be up to {MAX_VIDEO_BYTES // 1024**2} MB."},
    )
    content_type = serializers.ChoiceField(
        choices=list(EXTENSIONS), error_messages={"invalid_choice": "Upload an MP4, MOV or WebM."}
    )


class VideoChunkSerializer(serializers.Serializer):
    offset = serializers.IntegerField(min_value=0)
    chunk = serializers.FileField(allow_empty_file=False)


class VideoUploadStateSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True, source="pk")
    bytes_received = serializers.IntegerField(read_only=True)
    chunk_size = serializers.SerializerMethodField()
    is_complete = serializers.SerializerMethodField()

    def get_chunk_size(self, obj) -> int:
        return CHUNK_BYTES

    def get_is_complete(self, obj) -> bool:
        return bool(obj.drive_file_id)


class StoredVideoSerializer(serializers.ModelSerializer):
    """Subclass with a ``Meta`` naming the model."""

    url = serializers.SerializerMethodField()
    poster_url = serializers.SerializerMethodField()

    class Meta:
        fields = ["id", "original_name", "content_type", "size_bytes", "url", "poster_url"]
        read_only_fields = fields

    def get_url(self, obj) -> str:
        return content_url(obj.content_url_name, obj.pk)

    def get_poster_url(self, obj) -> str:
        return content_url(obj.content_url_name, obj.pk, thumbnail=True)


def _is_video(head: bytes, content_type: str) -> bool:
    if content_type == "video/webm":
        return head.startswith(b"\x1a\x45\xdf\xa3")
    return head[4:8] in _MP4_BOX_TYPES


def start_upload(model, data, *, existing: int, limit_message, project, semester, label, owner):
    """Validate a video's details and open its Drive session."""
    serializer = VideoUploadStartSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    if existing >= MAX_VIDEOS_PER_OWNER:
        raise ValidationError({"name": limit_message})

    details = serializer.validated_data
    extension = EXTENSIONS[details["content_type"]]
    storage = get_storage()
    try:
        session = storage.start_resumable(
            f"{label} {uuid.uuid4().hex[:8]}.{extension}",
            details["content_type"],
            details["size"],
            semester_folder(project, semester, storage),
        )
    except StorageError as error:
        raise ImageStorageUnavailable(str(error)) from error
    return model.objects.create(
        original_name=PurePath(details["name"]).name[:255],
        content_type=details["content_type"],
        size_bytes=details["size"],
        upload_session=session,
        **owner,
    )


def _apply_chunk(video, storage, offset: int, content: bytes):
    """Advance ``video`` by one chunk. Returns the error to raise, if any."""
    if video.drive_file_id:
        return None

    if video.needs_sync:
        # The last send failed partway, so only Drive knows how far it got.
        try:
            progress = storage.query_resumable(video.upload_session, video.size_bytes)
        except StorageError as error:
            return ImageStorageUnavailable(str(error))
        video.bytes_received = progress.received
        video.needs_sync = False
        if progress.file_id:
            video.finish(progress.file_id)
            return None

    # Anything else is a retry of a chunk that already landed. The response
    # reports where to carry on, so the client can correct itself.
    if offset != video.bytes_received:
        video.save()
        return None

    end = offset + len(content)
    is_last = end == video.size_bytes
    if end > video.size_bytes or (not is_last and len(content) % CHUNK_UNIT_BYTES):
        return ValidationError({"chunk": "That piece of the video is the wrong size."})
    if offset == 0 and not _is_video(content, video.content_type):
        video.is_deleted = True
        video.save()
        return ValidationError({"chunk": "That file is not a valid MP4, MOV or WebM video."})

    try:
        file_id = storage.send_chunk(video.upload_session, content, offset, video.size_bytes)
    except StorageError as error:
        video.needs_sync = True
        video.save()
        return ImageStorageUnavailable(str(error))

    video.bytes_received = end
    if file_id:
        video.finish(file_id)
    else:
        video.save()
    return None


def receive_chunk(videos, pk, data):
    """Relay one chunk to Drive and return the updated row.

    The row is locked across the Drive call, so two copies of the same chunk
    cannot both be sent. The error is raised after the transaction so that
    what was recorded about the failure is kept.
    """
    serializer = VideoChunkSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    offset = serializer.validated_data["offset"]
    content = serializer.validated_data["chunk"].read()

    with transaction.atomic():
        video = videos.select_for_update().filter(pk=pk, is_deleted=False).first()
        if video is None:
            raise Http404
        error = _apply_chunk(video, get_storage(), offset, content)
    if error is not None:
        raise error
    return video


def serve_video(request, pk: int, videos):
    """Stream a video to a `<video>` tag, honouring the Range requests that seeking uses."""
    url_name = videos.model.content_url_name
    if not is_valid_signature(url_name, pk, request.GET.get("exp", ""), request.GET.get("sig", "")):
        return HttpResponseForbidden()
    video = videos.filter(pk=pk).first()
    if video is None:
        raise Http404

    storage = get_storage()
    cache_control = f"private, max-age={CACHE_SECONDS}"
    if request.GET.get("variant") == "thumbnail":
        # No fallback to the original, which would download a whole video
        # just to draw a poster.
        thumbnail = storage.thumbnail(video.drive_file_id, THUMBNAIL_PIXELS)
        if thumbnail is None:
            raise Http404
        response = HttpResponse(thumbnail.content, content_type=thumbnail.content_type)
        response["Cache-Control"] = cache_control
        return response

    requested = request.headers.get("Range", "")
    try:
        stream = storage.open_range(
            video.drive_file_id, requested if _RANGE.match(requested) else None
        )
    except StorageError as error:
        return HttpResponse(str(error), status=502, content_type="text/plain")

    response = StreamingHttpResponse(
        stream.chunks, status=stream.status, content_type=video.content_type
    )
    response["Accept-Ranges"] = "bytes"
    response["Cache-Control"] = cache_control
    if stream.content_length is not None:
        response["Content-Length"] = stream.content_length
    if stream.content_range:
        response["Content-Range"] = stream.content_range
    return response
