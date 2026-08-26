"""Auth endpoints.

The access token goes back in the response body for the SPA to hold in memory.
The refresh token is set as an httpOnly cookie so a cross-site script cannot
read it — the tradeoff is that refresh/logout depend on the cookie riding along,
which is why CORS runs with credentials enabled.
"""

import contextlib

from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.projects.models import Membership, Semester

from .authentication import UnauthenticatedBearerRealm
from .serializers import GoogleLoginSerializer, SessionSerializer, UserSerializer
from .services import get_or_create_user, identity_from_credential


def _membership_payload(user) -> list[dict]:
    """The user's roles **this semester**, for the SPA's session state.

    Scoped to the current term because the SPA reads these to decide which
    write affordances to render. Listing every term a user has ever been in
    would put an Edit button in front of a lead who stepped down two years ago
    — the server would still refuse the save, but only after they had typed it.

    Archive *read* access is a separate question and is answered per project by
    `/api/projects/`, which stays unscoped by term.
    """
    semester = Semester.current()
    if semester is None:
        return []

    rows = (
        Membership.objects.filter(user=user, is_active=True, semester=semester)
        .select_related("project")
        .order_by("project__name")
    )
    return [
        {
            "project_id": m.project_id,
            "project_slug": m.project.slug,
            "project_name": m.project.name,
            "role": m.role,
        }
        for m in rows
    ]


def _session_response(user, refresh: RefreshToken) -> Response:
    body = {
        "access": str(refresh.access_token),
        "user": UserSerializer(user).data,
        "memberships": _membership_payload(user),
    }
    response = Response(body, status=status.HTTP_200_OK)
    response.set_cookie(
        settings.REFRESH_TOKEN_COOKIE_NAME,
        str(refresh),
        httponly=True,
        secure=settings.REFRESH_TOKEN_COOKIE_SECURE,
        samesite=settings.REFRESH_TOKEN_COOKIE_SAMESITE,
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        path="/api/auth/",
    )
    return response


class GoogleLoginView(APIView):
    """Exchange a verified Google ID token for a Nirmaan session."""

    permission_classes = [AllowAny]
    authentication_classes = [UnauthenticatedBearerRealm]

    @extend_schema(request=GoogleLoginSerializer, responses=SessionSerializer)
    def post(self, request: Request) -> Response:
        serializer = GoogleLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        identity = identity_from_credential(serializer.validated_data["credential"])
        user, _created = get_or_create_user(identity)

        return _session_response(user, RefreshToken.for_user(user))


class RefreshView(APIView):
    """Mint a new access token from the refresh cookie."""

    permission_classes = [AllowAny]
    authentication_classes = [UnauthenticatedBearerRealm]

    @extend_schema(request=None, responses=SessionSerializer)
    def post(self, request: Request) -> Response:
        raw = request.COOKIES.get(settings.REFRESH_TOKEN_COOKIE_NAME)
        if not raw:
            raise AuthenticationFailed("No refresh token.")

        try:
            old = RefreshToken(raw)
            user_id = old["user_id"]
            # Rotation: retire the presented token before issuing its successor.
            old.blacklist()
        except TokenError as exc:
            raise AuthenticationFailed("Refresh token is expired or invalid.") from exc

        from .models import User

        user = User.objects.filter(pk=user_id, is_active=True).first()
        if user is None:
            raise AuthenticationFailed("Account no longer active.")

        return _session_response(user, RefreshToken.for_user(user))


class LogoutView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = [UnauthenticatedBearerRealm]

    @extend_schema(request=None, responses={204: None})
    def post(self, request: Request) -> Response:
        raw = request.COOKIES.get(settings.REFRESH_TOKEN_COOKIE_NAME)
        if raw:
            # Already expired or unknown — the cookie still gets cleared.
            with contextlib.suppress(TokenError):
                RefreshToken(raw).blacklist()

        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(settings.REFRESH_TOKEN_COOKIE_NAME, path="/api/auth/")
        return response


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=SessionSerializer)
    def get(self, request: Request) -> Response:
        return Response(
            {
                "user": UserSerializer(request.user).data,
                "memberships": _membership_payload(request.user),
            }
        )
