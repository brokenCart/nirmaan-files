from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["email", "full_name", "is_exec", "is_active", "is_staff"]
    list_filter = ["is_exec", "is_active", "is_staff"]
    search_fields = ["email", "full_name"]
    ordering = ["email"]
    readonly_fields = ["google_sub", "created_at", "last_login"]

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profile", {"fields": ("full_name", "avatar_url", "google_sub")}),
        (
            "Permissions",
            {
                "fields": (
                    "is_exec",
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        ("Dates", {"fields": ("last_login", "created_at")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "full_name", "password1", "password2", "is_exec"),
            },
        ),
    )
