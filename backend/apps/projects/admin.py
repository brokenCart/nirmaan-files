from django.contrib import admin

from .models import Membership, Project, Semester


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 0
    autocomplete_fields = ["user", "semester"]


@admin.register(Semester)
class SemesterAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "starts_on", "ends_on", "is_current"]
    search_fields = ["name"]
    prepopulated_fields = {"slug": ("name",)}
    ordering = ["-starts_on"]

    @admin.display(boolean=True, description="Current")
    def is_current(self, obj: Semester) -> bool:
        return obj.is_current


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "is_active", "created_at"]
    list_filter = ["is_active"]
    search_fields = ["name", "description"]
    prepopulated_fields = {"slug": ("name",)}
    inlines = [MembershipInline]


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ["user", "project", "semester", "role", "is_active", "joined_at"]
    list_filter = ["semester", "role", "is_active", "project"]
    search_fields = ["user__email", "project__name"]
    autocomplete_fields = ["user", "project", "semester"]
