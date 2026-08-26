"""Shared fixtures and factories."""

import factory
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.logs.models import DailyLog, LogKind, LogStatus
from apps.projects.models import Membership, Project, Role

CAMPUS = "pilani.bits-pilani.ac.in"


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


class MembershipFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Membership

    user = factory.SubFactory(UserFactory)
    project = factory.SubFactory(ProjectFactory)
    role = Role.VOLUNTEER


class DailyLogFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = DailyLog

    project = factory.SubFactory(ProjectFactory)
    author = factory.SubFactory(UserFactory)
    kind = LogKind.MOV
    title = factory.Faker("sentence", nb_words=5)
    body = factory.Faker("paragraph")
    occurred_on = factory.Faker("date_object")
    status = LogStatus.PUBLISHED


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
