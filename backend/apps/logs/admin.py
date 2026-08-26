from django.contrib import admin

from .models import DailyLog


@admin.register(DailyLog)
class DailyLogAdmin(admin.ModelAdmin):
    list_display = ["title", "kind", "project", "occurred_on", "author", "status", "is_deleted"]
    list_filter = ["kind", "status", "is_deleted", "project"]
    search_fields = ["title", "body"]
    date_hierarchy = "occurred_on"
    autocomplete_fields = ["project", "author", "attendees"]
