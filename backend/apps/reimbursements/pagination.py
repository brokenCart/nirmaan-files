from rest_framework.pagination import PageNumberPagination


class ReimbursementPagination(PageNumberPagination):
    """Queue paging, scoped to this viewset.

    Paginated at all — unlike the resource shelf and the knowledge index, which
    return everything — because those two are bounded by a project's own
    tidiness and this one is not. Nobody prunes last month's claims; the term
    scope caps how far back the default list reaches, but a busy project can
    still file a few hundred within one.

    Declared here rather than leaning on ``REST_FRAMEWORK["PAGE_SIZE"]`` for the
    reason :class:`~apps.logs.pagination.DailyLogPagination` is: the SPA mirrors
    this number to turn ``count`` into a page total, and a page size that can
    move when an unrelated global setting moves is one the client cannot track.
    Change this and ``frontend/src/features/projects/queries.ts`` together.
    """

    page_size = 20
