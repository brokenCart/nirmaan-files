"""Receiving, storing and serving images attached to a record.

Shared by entry photos and reimbursement receipts, so there is one upload path.
Each caller brings its own :class:`~apps.drive.models.StoredFile` model and its
own rule for who may attach.
"""

import time
import uuid
from pathlib import PurePath

from django.core.signing import Signer
from django.http import Http404, HttpResponse, HttpResponseForbidden, StreamingHttpResponse
from django.urls import reverse
from django.utils.crypto import constant_time_compare
from rest_framework import serializers, status
from rest_framework.exceptions import APIException, ValidationError

from .storage import StorageError, get_storage, semester_folder

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGES_PER_OWNER = 10
THUMBNAIL_PIXELS = 640
# Deliberately no SVG: it can carry script, and these are served from our origin.
ALLOWED_FORMATS = {
    "JPEG": ("image/jpeg", "jpg"),
    "PNG": ("image/png", "png"),
    "WEBP": ("image/webp", "webp"),
}

URL_WINDOW_SECONDS = 60 * 60
CACHE_SECONDS = URL_WINDOW_SECONDS

_signer = Signer(salt="drive.image-content")


class ImageStorageUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "Image storage is unavailable."


def _signature(url_name: str, pk: int, expires: int) -> str:
    # The route is signed too, or a signature for photo 7 would open receipt 7.
    return _signer.signature(f"{url_name}:{pk}:{expires}")


def content_url(url_name: str, pk: int, *, thumbnail: bool = False) -> str:
    """A signed URL, valid for one to two hours.

    The expiry is rounded to a window so a URL stays identical across refetches
    within it. A new URL each time would defeat the browser's cache.
    """
    expires = (int(time.time()) // URL_WINDOW_SECONDS + 2) * URL_WINDOW_SECONDS
    query = f"exp={expires}&sig={_signature(url_name, pk, expires)}"
    if thumbnail:
        query += "&variant=thumbnail"
    return f"{reverse(url_name, args=[pk])}?{query}"


def is_valid_signature(url_name: str, pk: int, expires: str, signature: str) -> bool:
    if not expires.isdecimal() or int(expires) < time.time():
        return False
    return constant_time_compare(signature, _signature(url_name, pk, int(expires)))


class ImageUploadSerializer(serializers.Serializer):
    image = serializers.ImageField(write_only=True)

    def validate_image(self, value):
        if value.size > MAX_IMAGE_BYTES:
            raise serializers.ValidationError(
                f"Images can be up to {MAX_IMAGE_BYTES // (1024 * 1024)} MB."
            )
        # `ImageField` has already opened the file and set `.image`, so this is
        # the format of the actual bytes rather than the name or claimed type.
        if value.image.format not in ALLOWED_FORMATS:
            raise serializers.ValidationError("Upload a JPEG, PNG or WebP image.")
        return value


class StoredImageSerializer(serializers.ModelSerializer):
    """Subclass with a ``Meta`` naming the model."""

    url = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        fields = ["id", "original_name", "content_type", "size_bytes", "url", "thumbnail_url"]
        read_only_fields = fields

    def get_url(self, obj) -> str:
        return content_url(obj.content_url_name, obj.pk)

    def get_thumbnail_url(self, obj) -> str:
        return content_url(obj.content_url_name, obj.pk, thumbnail=True)


def attach_image(
    model, data, *, existing: int, limit_message: str, project, semester, label, owner, section=""
):
    """Validate an upload, put it in the term's folder and record it.

    ``label`` starts the file name, so the Drive folder is browsable. ``owner``
    holds the model's foreign key to the record the image belongs to.
    """
    serializer = ImageUploadSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    if existing >= MAX_IMAGES_PER_OWNER:
        raise ValidationError({"image": limit_message})

    upload = serializer.validated_data["image"]
    content_type, extension = ALLOWED_FORMATS[upload.image.format]
    content = upload.read()
    storage = get_storage()
    try:
        file_id = storage.upload(
            f"{label} {uuid.uuid4().hex[:8]}.{extension}",
            content,
            content_type,
            semester_folder(project, semester, storage, section=section),
        )
    except StorageError as error:
        raise ImageStorageUnavailable(str(error)) from error
    return model.objects.create(
        drive_file_id=file_id,
        original_name=PurePath(upload.name).name[:255],
        content_type=content_type,
        size_bytes=len(content),
        **owner,
    )


def serve_image(request, pk: int, images):
    """Serve an image to an `<img>` tag, which cannot send the bearer token.

    The signature stands in for it: only a serializer that has already passed
    the owner's ``visible_to`` issues one. ``images`` must exclude anything
    removed, so a removal takes effect at once.
    """
    url_name = images.model.content_url_name
    if not is_valid_signature(url_name, pk, request.GET.get("exp", ""), request.GET.get("sig", "")):
        return HttpResponseForbidden()
    image = images.filter(pk=pk).first()
    if image is None:
        raise Http404

    storage = get_storage()
    cache_control = f"private, max-age={CACHE_SECONDS}"
    if request.GET.get("variant") == "thumbnail":
        thumbnail = storage.thumbnail(image.drive_file_id, THUMBNAIL_PIXELS)
        if thumbnail is not None:
            response = HttpResponse(thumbnail.content, content_type=thumbnail.content_type)
            response["Cache-Control"] = cache_control
            return response

    try:
        chunks = storage.open(image.drive_file_id)
    except StorageError as error:
        return HttpResponse(str(error), status=502, content_type="text/plain")
    response = StreamingHttpResponse(chunks, content_type=image.content_type)
    response["Cache-Control"] = cache_control
    return response
