"""Campus email domain rules.

Kept apart from models so both the model validator and the Google token
verifier can import it without a circular dependency.
"""

from django.conf import settings


def email_domain(email: str) -> str:
    return email.rsplit("@", 1)[-1].strip().lower()


def is_allowed_email(email: str) -> bool:
    """True when ``email`` belongs to the single permitted campus domain.

    Deliberately an exact match, not a suffix check: a suffix test would also
    accept ``evilpilani.bits-pilani.ac.in`` and lookalike domains.
    """
    if not email or "@" not in email:
        return False
    return email_domain(email) == settings.ALLOWED_EMAIL_DOMAIN.lower()
