"""Google sign-in: the domain gate, and what a rejected login must not leave behind."""

import json

import pytest
from django.conf import settings
from django.urls import reverse
from rest_framework.exceptions import AuthenticationFailed

from apps.accounts.domain import is_allowed_email
from apps.accounts.models import User
from apps.accounts.services import get_or_create_user, identity_from_credential
from apps.conftest import CAMPUS, MembershipFactory, UserFactory
from apps.projects.models import Role

pytestmark = pytest.mark.django_db


def credential(**overrides) -> str:
    """A claims blob, accepted verbatim because test settings fake verification."""
    claims = {
        "iss": "https://accounts.google.com",
        "sub": "google-subject-1",
        "email": f"student@{CAMPUS}",
        "email_verified": True,
        "name": "Test Student",
        "picture": "https://example.com/a.png",
    }
    claims.update(overrides)
    return json.dumps(claims)


class TestDomainRule:
    @pytest.mark.parametrize(
        "email",
        [
            f"student@{CAMPUS}",
            f"F20230001@{CAMPUS}",
        ],
    )
    def test_campus_addresses_are_allowed(self, email):
        assert is_allowed_email(email)

    @pytest.mark.parametrize(
        "email",
        [
            "student@goa.bits-pilani.ac.in",
            "student@hyderabad.bits-pilani.ac.in",
            "student@bits-pilani.ac.in",
            "someone@gmail.com",
            # A suffix check rather than an exact match would admit these.
            "attacker@evil-pilani.bits-pilani.ac.in",
            "attacker@pilani.bits-pilani.ac.in.evil.com",
            "",
            "not-an-email",
        ],
    )
    def test_everything_else_is_refused(self, email):
        assert not is_allowed_email(email)


class TestCredentialVerification:
    def test_valid_campus_credential_yields_an_identity(self):
        identity = identity_from_credential(credential())
        assert identity.email == f"student@{CAMPUS}"
        assert identity.sub == "google-subject-1"

    def test_non_campus_account_is_refused(self):
        with pytest.raises(AuthenticationFailed):
            identity_from_credential(credential(email="someone@gmail.com"))

    def test_unverified_email_is_refused(self):
        with pytest.raises(AuthenticationFailed):
            identity_from_credential(credential(email_verified=False))

    def test_foreign_issuer_is_refused(self):
        with pytest.raises(AuthenticationFailed):
            identity_from_credential(credential(iss="https://accounts.evil.com"))

    def test_missing_subject_is_refused(self):
        with pytest.raises(AuthenticationFailed):
            identity_from_credential(credential(sub=None))

    def test_email_case_is_normalised(self):
        identity = identity_from_credential(credential(email=f"Student@{CAMPUS.upper()}"))
        assert identity.email == f"student@{CAMPUS}"


class TestLoginEndpoint:
    def test_login_returns_a_session(self, api):
        response = api.post(
            reverse("accounts:google-login"), {"credential": credential()}, format="json"
        )
        assert response.status_code == 200
        assert response.data["access"]
        assert response.data["user"]["email"] == f"student@{CAMPUS}"
        assert response.data["memberships"] == []

    def test_refresh_token_is_httponly_and_not_in_the_body(self, api):
        response = api.post(
            reverse("accounts:google-login"), {"credential": credential()}, format="json"
        )
        cookie = response.cookies[settings.REFRESH_TOKEN_COOKIE_NAME]
        assert cookie["httponly"] is True
        assert cookie["samesite"] == "Lax"
        assert "refresh" not in response.data

    def test_rejected_login_creates_no_user(self, api):
        response = api.post(
            reverse("accounts:google-login"),
            {"credential": credential(email="outsider@gmail.com")},
            format="json",
        )
        assert response.status_code == 401
        assert not User.objects.filter(email="outsider@gmail.com").exists()

    def test_login_reports_existing_memberships(self, api, project):
        user = UserFactory(email=f"student@{CAMPUS}")
        MembershipFactory(user=user, project=project, role=Role.LEAD)
        response = api.post(
            reverse("accounts:google-login"), {"credential": credential()}, format="json"
        )
        assert response.data["memberships"] == [
            {
                "project_id": project.pk,
                "project_slug": project.slug,
                "project_name": project.name,
                "role": Role.LEAD,
            }
        ]


class TestUserMapping:
    def test_repeat_login_does_not_duplicate_the_user(self):
        identity = identity_from_credential(credential())
        first, created_first = get_or_create_user(identity)
        second, created_second = get_or_create_user(identity)
        assert created_first is True
        assert created_second is False
        assert first.pk == second.pk

    def test_placeholder_row_is_adopted_on_first_login(self, project):
        """A lead adds someone by email before they have ever signed in."""
        placeholder = UserFactory(email=f"student@{CAMPUS}")
        MembershipFactory(user=placeholder, project=project, role=Role.VOLUNTEER)
        assert placeholder.google_sub is None

        user, created = get_or_create_user(identity_from_credential(credential()))

        assert created is False
        assert user.pk == placeholder.pk
        assert user.google_sub == "google-subject-1"
        assert user.memberships.count() == 1

    def test_matching_prefers_google_sub_over_email(self):
        """An email change at Google must not fork the account."""
        user, _ = get_or_create_user(identity_from_credential(credential()))
        renamed = identity_from_credential(credential(email=f"newname@{CAMPUS}"))
        again, created = get_or_create_user(renamed)
        assert created is False
        assert again.pk == user.pk
        assert again.email == f"newname@{CAMPUS}"

    def test_deactivated_account_cannot_sign_in(self):
        user, _ = get_or_create_user(identity_from_credential(credential()))
        user.is_active = False
        user.save(update_fields=["is_active"])
        with pytest.raises(AuthenticationFailed):
            get_or_create_user(identity_from_credential(credential()))


class TestSessionLifecycle:
    def _login(self, api):
        return api.post(
            reverse("accounts:google-login"), {"credential": credential()}, format="json"
        )

    def test_refresh_issues_a_new_access_token(self, api):
        self._login(api)
        response = api.post(reverse("accounts:refresh"))
        assert response.status_code == 200
        assert response.data["access"]

    def test_refresh_without_a_cookie_is_rejected(self, api):
        assert api.post(reverse("accounts:refresh")).status_code == 401

    def test_logout_invalidates_the_refresh_token(self, api):
        self._login(api)
        assert api.post(reverse("accounts:logout")).status_code == 204
        # The cookie is cleared client-side; the token is blacklisted server-side
        # so a stolen copy is useless.
        assert api.post(reverse("accounts:refresh")).status_code == 401

    def test_rotated_refresh_token_cannot_be_replayed(self, api):
        self._login(api)
        stolen = api.cookies[settings.REFRESH_TOKEN_COOKIE_NAME].value

        assert api.post(reverse("accounts:refresh")).status_code == 200

        api.cookies[settings.REFRESH_TOKEN_COOKIE_NAME] = stolen
        assert api.post(reverse("accounts:refresh")).status_code == 401

    def test_me_requires_authentication(self, api):
        assert api.get(reverse("accounts:me")).status_code == 401

    def test_me_returns_the_current_user(self, auth_client, lead, project):
        response = auth_client(lead).get(reverse("accounts:me"))
        assert response.status_code == 200
        assert response.data["user"]["email"] == lead.email
        assert response.data["memberships"][0]["role"] == Role.LEAD


class TestUserModel:
    def test_email_is_stored_lowercase(self):
        user = User.objects.create_user(email=f"MixedCase@{CAMPUS}")
        assert user.email == f"mixedcase@{CAMPUS}"

    def test_non_campus_email_is_rejected_at_the_model(self):
        from django.core.exceptions import ValidationError

        with pytest.raises(ValidationError):
            User.objects.create_user(email="someone@gmail.com")

    def test_superuser_is_exec_by_default(self):
        user = User.objects.create_superuser(email=f"admin@{CAMPUS}", password="x")
        assert user.is_exec is True
        assert user.is_staff is True
