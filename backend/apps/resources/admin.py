from django.contrib import admin

from .models import Resource


@admin.register(Resource)
class ResourceAdmin(admin.ModelAdmin):
    list_display = ["title", "kind", "project", "url", "added_by", "updated_at"]
    list_filter = ["kind", "project"]
    search_fields = ["title", "description", "url"]
    autocomplete_fields = ["project", "added_by"]
