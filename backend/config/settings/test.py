"""Test settings.

Runs against Postgres like production does — the suite exercises unique
constraints and case handling, and SQLite would not reproduce them faithfully.
Start the database with ``docker compose up -d db``.
"""

from .base import *  # noqa: F403

DEBUG = False
# At least 32 bytes, or PyJWT warns on every HS256 signature.
SECRET_KEY = "test-only-key-not-used-anywhere-real-0123456789"
ALLOWED_HOSTS = ["*"]
REFRESH_TOKEN_COOKIE_SECURE = False

GOOGLE_OAUTH_CLIENT_ID = "test-client-id.apps.googleusercontent.com"

# Tests build identities directly through apps.accounts.services, so no real
# token verification happens; this keeps that explicit.
AUTH_FAKE_GOOGLE_TOKENS = True

# Hashing dominates runtime otherwise, and sign-in is Google-only anyway.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# `apps/conftest.py` points this at a per-test temporary directory.
DRIVE_STORAGE_BACKEND = "apps.drive.storage.LocalStorage"
DRIVE_LOCAL_ROOT = "/nonexistent"
