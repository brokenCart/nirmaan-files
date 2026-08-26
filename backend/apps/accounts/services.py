"""Google sign-in: verify an ID token, then map it to a local user."""

from __future__ import annotations

import json
from dataclasses import dataclass

from django.conf import settings
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from rest_framework.exceptions import AuthenticationFailed

from .domain import is_allowed_email
from .models import User

GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    full_name: str
    avatar_url: str


def _verify_with_google(credential: str) -> dict:
    if not settings.GOOGLE_OAUTH_CLIENT_ID:
        raise AuthenticationFailed("Google sign-in is not configured on this server.")
    try:
        return google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            settings.GOOGLE_OAUTH_CLIENT_ID,
        )
    except ValueError as exc:
        # Covers a bad signature, wrong audience, and expiry alike.
        raise AuthenticationFailed("Invalid Google credential.") from exc


def _claims_from_credential(credential: str) -> dict:
    """Return verified claims for ``credential``.

    In development, ``AUTH_FAKE_GOOGLE_TOKENS`` lets a plain JSON blob stand in
    for a signed token so the login flow can be exercised without OAuth
    credentials. The flag defaults to off and does not exist in production
    settings.
    """
    if getattr(settings, "AUTH_FAKE_GOOGLE_TOKENS", False):
        try:
            return json.loads(credential)
        except json.JSONDecodeError as exc:
            raise AuthenticationFailed("Expected a JSON claims blob in fake-token mode.") from exc
    return _verify_with_google(credential)


def identity_from_credential(credential: str) -> GoogleIdentity:
    """Validate a Google credential and extract the identity we trust.

    Every check here is server-side on purpose. The `hd` parameter the frontend
    passes to the Google button only pre-filters the account chooser — a caller
    can post any token they like straight to this endpoint, so the issuer,
    verified-email, and domain checks below are the real gate.
    """
    claims = _claims_from_credential(credential)

    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise AuthenticationFailed("Untrusted token issuer.")

    if not claims.get("email_verified"):
        raise AuthenticationFailed("This Google account has no verified email address.")

    email = (claims.get("email") or "").strip().lower()
    if not is_allowed_email(email):
        raise AuthenticationFailed(
            f"Sign in with your @{settings.ALLOWED_EMAIL_DOMAIN} account. "
            "Other Google accounts cannot access Nirmaan Files."
        )

    sub = claims.get("sub")
    if not sub:
        raise AuthenticationFailed("Google token is missing a subject identifier.")

    return GoogleIdentity(
        sub=sub,
        email=email,
        full_name=(claims.get("name") or "").strip(),
        avatar_url=(claims.get("picture") or "").strip(),
    )


def get_or_create_user(identity: GoogleIdentity) -> tuple[User, bool]:
    """Resolve a verified Google identity to a local user.

    Matching prefers ``google_sub`` and falls back to email, which adopts users
    seeded by an admin before their first login. A user arrives with no
    memberships and therefore sees nothing until a lead or exec adds them to a
    project.
    """
    user = User.objects.filter(google_sub=identity.sub).first()
    created = False

    if user is None:
        user, created = User.objects.get_or_create(
            email=identity.email,
            defaults={
                "full_name": identity.full_name,
                "avatar_url": identity.avatar_url,
                "google_sub": identity.sub,
                "is_active": True,
            },
        )
        if not created and user.google_sub is None:
            user.google_sub = identity.sub

    if not user.is_active:
        raise AuthenticationFailed("This account has been deactivated.")

    # Google stays the source of truth for display details.
    user.email = identity.email
    user.full_name = identity.full_name or user.full_name
    user.avatar_url = identity.avatar_url or user.avatar_url
    user.save(update_fields=["email", "full_name", "avatar_url", "google_sub"])

    return user, created
