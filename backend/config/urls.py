from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from apps.knowledge.views import ArticleViewSet
from apps.logs.views import DailyLogViewSet, log_image_content, log_video_content
from apps.projects.views import MembershipViewSet, ProjectViewSet, SemesterViewSet
from apps.reimbursements.views import ReimbursementViewSet, receipt_content
from apps.resources.views import ResourceViewSet

router = DefaultRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("semesters", SemesterViewSet, basename="semester")
router.register("memberships", MembershipViewSet, basename="membership")
router.register("logs", DailyLogViewSet, basename="log")
router.register("resources", ResourceViewSet, basename="resource")
router.register("articles", ArticleViewSet, basename="article")
router.register("reimbursements", ReimbursementViewSet, basename="reimbursement")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/log-images/<int:pk>/content/", log_image_content, name="log-image-content"),
    path("api/log-videos/<int:pk>/content/", log_video_content, name="log-video-content"),
    path(
        "api/reimbursement-receipts/<int:pk>/content/",
        receipt_content,
        name="reimbursement-receipt-content",
    ),
    path("api/", include(router.urls)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
]
