"""Local development settings."""

from .base import *  # noqa: F403
from .base import env_bool

DEBUG = True
ALLOWED_HOSTS = ["*"]

# Served over plain http on localhost, so the refresh cookie cannot be Secure or
# the browser will silently drop it.
REFRESH_TOKEN_COOKIE_SECURE = False

# Opt out of Google verification when developing without OAuth credentials: any
# posted credential is treated as a pre-verified claims dict. Never enable
# outside local work.
AUTH_FAKE_GOOGLE_TOKENS = env_bool("AUTH_FAKE_GOOGLE_TOKENS", False)
