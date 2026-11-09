"""Shared fixtures and factories."""

import datetime
from decimal import Decimal

import factory
import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.drive.storage import get_storage
from apps.knowledge.models import Article, ArticleCategory
from apps.logs.models import DailyLog, LogKind, LogStatus
from apps.projects.models import Membership, Project, Role, Semester
from apps.reimbursements.models import Reimbursement
from apps.resources.models import Resource, ResourceKind

CAMPUS = "pilani.bits-pilani.ac.in"


def current_term() -> Semester:
    """The term the tests run in, created on first use.

    Deliberately wide — six months either side of today — so that a test which
    hardcodes a date does not have to know the BITS calendar to stay inside the
    open semester. Tests that care about the boundary use the `past_semester`
    fixture to put something the other side of it.
    """
    today = timezone.localdate()
    existing = Semester.objects.filter(starts_on__lte=today, ends_on__gte=today).first()
    if existing is not None:
        return existing
    return Semester.objects.create(
        name="Current Term",
        starts_on=today - datetime.timedelta(days=180),
        ends_on=today + datetime.timedelta(days=180),
    )


class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User
        django_get_or_create = ("email",)

    email = factory.Sequence(lambda n: f"f{2020}{n:04d}@{CAMPUS}")
    full_name = factory.Faker("name")
    is_exec = False


class ProjectFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Project

    name = factory.Sequence(lambda n: f"Project {n}")
    description = factory.Faker("sentence")


class SemesterFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Semester
        django_get_or_create = ("name",)

    name = factory.Sequence(lambda n: f"Term {n}")


class MembershipFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Membership

    user = factory.SubFactory(UserFactory)
    project = factory.SubFactory(ProjectFactory)
    # A plain SubFactory would mint a fresh term per membership, and terms may
    # not overlap — every membership defaults into the one open term instead.
    semester = factory.LazyFunction(current_term)
    role = Role.VOLUNTEER


class DailyLogFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = DailyLog

    project = factory.SubFactory(ProjectFactory)
    author = factory.SubFactory(UserFactory)
    kind = LogKind.MOV
    title = factory.Faker("sentence", nb_words=5)
    body = factory.Faker("paragraph")
    # Today rather than a random date: `occurred_on` decides which term the
    # entry lands in, and a date from 1974 belongs to no semester at all.
    occurred_on = factory.LazyFunction(lambda: timezone.localdate())
    status = LogStatus.PUBLISHED


class ResourceFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Resource

    project = factory.SubFactory(ProjectFactory)
    added_by = factory.SubFactory(UserFactory)
    kind = ResourceKind.OTHER
    title = factory.Sequence(lambda n: f"Resource {n}")
    # Sequenced rather than faked: `url` is unique per project, and a faker
    # that repeats itself would fail the constraint rather than the assertion.
    url = factory.Sequence(lambda n: f"https://drive.google.com/drive/folders/seed{n}")


class ArticleFactory(factory.django.DjangoModelFactory):
    """A knowledge base page.

    ``created_by`` and ``updated_by`` are one person by default — a page nobody
    has edited yet. Tests about the open edit rule set them apart deliberately.

    No revision is created: `record_revision` is the viewset's job, so a factory
    row starts with an empty history, which is also what a test asserting that
    the first edit records one wants.
    """

    class Meta:
        model = Article

    project = factory.SubFactory(ProjectFactory)
    created_by = factory.SubFactory(UserFactory)
    updated_by = factory.LazyAttribute(lambda article: article.created_by)
    category = ArticleCategory.CONTEXT
    # Sequenced rather than faked: one live title per project is a constraint,
    # and a faker that repeats itself would fail it rather than the assertion.
    title = factory.Sequence(lambda n: f"Article {n}")
    body = factory.Faker("paragraph")


class ReimbursementFactory(factory.django.DjangoModelFactory):
    """A claim awaiting review.

    No ``semester``: `Reimbursement.save` stamps the open term, which is what a
    request filed through the API gets, and passing one would let a test drift
    out of the term its fixtures live in. Tests about the frozen-archive rule
    set ``semester=past_semester`` explicitly.

    Left ``PENDING`` — the state every request starts in and the one most rules
    branch on. Tests about the freeze approve or reject it first.
    """

    class Meta:
        model = Reimbursement

    project = factory.SubFactory(ProjectFactory)
    submitted_by = factory.SubFactory(UserFactory)
    title = factory.Sequence(lambda n: f"Reimbursement {n}")
    # Sequenced rather than faked, and distinct per row, so a test asserting a
    # summary total fails on the arithmetic rather than on two rows happening
    # to carry the same figure.
    amount = factory.Sequence(lambda n: Decimal(f"{100 + n}.50"))
    description = factory.Faker("sentence")


@pytest.fixture(autouse=True)
def isolated_storage(settings, tmp_path):
    """Every test stores files in its own temporary directory."""
    settings.DRIVE_LOCAL_ROOT = tmp_path / "drive"
    get_storage.cache_clear()
    yield settings.DRIVE_LOCAL_ROOT
    get_storage.cache_clear()


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def auth_client():
    """Return a callable that yields an APIClient authenticated as ``user``."""

    def _make(user: User) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    return _make


@pytest.fixture
def semester(db):
    """The open term. Everything the other fixtures create lives here."""
    return current_term()


@pytest.fixture
def past_semester(db, semester):
    """A term that has already ended — the archive side of the boundary."""
    return SemesterFactory(
        name="Previous Term",
        starts_on=semester.starts_on - datetime.timedelta(days=200),
        ends_on=semester.starts_on - datetime.timedelta(days=1),
    )


@pytest.fixture
def project(db):
    return ProjectFactory(name="Education")


@pytest.fixture
def other_project(db):
    return ProjectFactory(name="Healthcare")


@pytest.fixture
def exec_user(db):
    return UserFactory(email=f"exec@{CAMPUS}", is_exec=True)


@pytest.fixture
def lead(db, project):
    user = UserFactory(email=f"lead@{CAMPUS}")
    MembershipFactory(user=user, project=project, role=Role.LEAD)
    return user


@pytest.fixture
def finance_lead(db, project):
    user = UserFactory(email=f"finance@{CAMPUS}")
    MembershipFactory(user=user, project=project, role=Role.FINANCE_LEAD)
    return user


@pytest.fixture
def volunteer(db, project):
    user = UserFactory(email=f"volunteer@{CAMPUS}")
    MembershipFactory(user=user, project=project, role=Role.VOLUNTEER)
    return user


@pytest.fixture
def outsider(db, other_project):
    """A member of a *different* project — the key negative case."""
    user = UserFactory(email=f"outsider@{CAMPUS}")
    MembershipFactory(user=user, project=other_project, role=Role.LEAD)
    return user


@pytest.fixture
def past_lead(db, project, past_semester):
    """Led the project last term and was not carried into this one.

    The negative case the semester model exists for. Read access survives —
    they can still open the archive they wrote — and every write power is gone,
    including the ones a current lead has. Any endpoint that resolves a write
    against unscoped membership will hand this user their old authority back,
    which is exactly what these tests are watching for.
    """
    user = UserFactory(email=f"past.lead@{CAMPUS}")
    MembershipFactory(user=user, project=project, semester=past_semester, role=Role.LEAD)
    return user
