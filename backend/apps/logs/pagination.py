from rest_framework.pagination import PageNumberPagination


class DailyLogPagination(PageNumberPagination):
    """Timeline paging, deliberately smaller than the project-wide default.

    Scoped to this viewset rather than raised as ``REST_FRAMEWORK["PAGE_SIZE"]``
    because other endpoints are consumed as whole lists — the SPA's members
    sidebar reads ``/api/memberships/`` and renders ``results`` with no paging
    control, so shrinking the global page size would silently truncate it.

    ``frontend/src/features/projects/queries.ts`` mirrors this number to turn
    ``count`` into a page total; change both together.
    """

    page_size = 10
