"""Local development settings."""

from .base import *  # noqa: F403
from .base import BASE_DIR, DRIVE_ROOT_FOLDER_ID, env_bool

DEBUG = True
ALLOWED_HOSTS = ["*"]

# Served over plain http on localhost, so the refresh cookie cannot be Secure or
# the browser will silently drop it.
REFRESH_TOKEN_COOKIE_SECURE = False

# Opt out of Google verification when developing without OAuth credentials: any
# posted credential is treated as a pre-verified claims dict. Never enable
# outside local work.
AUTH_FAKE_GOOGLE_TOKENS = env_bool("AUTH_FAKE_GOOGLE_TOKENS", False)

# Images go to local disk until real Drive details are in .env. Defined here and
# in test.py only, so this cannot be switched on in production.
if not DRIVE_ROOT_FOLDER_ID:
    DRIVE_STORAGE_BACKEND = "apps.drive.storage.LocalStorage"
    DRIVE_LOCAL_ROOT = BASE_DIR / "media" / "drive"
