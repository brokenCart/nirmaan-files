from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import BaseAuthentication


class UnauthenticatedBearerRealm(BaseAuthentication):
    """Authenticates nobody, but declares the Bearer challenge.

    DRF downgrades a 401 to 403 whenever a view has no authenticator able to
    supply a ``WWW-Authenticate`` header. The login and refresh endpoints take
    no credentials — they read a cookie or a posted token — yet a bad credential
    there is genuinely "unauthenticated", not "forbidden". Declaring this class
    keeps those responses a 401 without letting an expired ``Authorization``
    header interfere with signing in again.
    """

    def authenticate(self, request):
        return None

    def authenticate_header(self, request) -> str:
        return 'Bearer realm="api"'


class UnauthenticatedBearerRealmScheme(OpenApiAuthenticationExtension):
    """Tells drf-spectacular that this class grants no security requirement."""

    target_class = UnauthenticatedBearerRealm
    name = "unauthenticated"

    def get_security_definition(self, auto_schema) -> dict:
        return {}

    def get_security_requirement(self, auto_schema) -> dict:
        return {}
