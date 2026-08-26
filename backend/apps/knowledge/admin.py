from django.contrib import admin

from .models import Article, ArticleRevision


class ArticleRevisionInline(admin.TabularInline):
    """History, read-only.

    Editable revisions would be a way to rewrite what a page used to say, which
    is the one thing the table exists to prevent.
    """

    model = ArticleRevision
    extra = 0
    can_delete = False
    fields = ["created_at", "edited_by", "title", "category", "note"]
    readonly_fields = fields

    def has_add_permission(self, request, obj=None) -> bool:
        return False


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ["title", "category", "project", "updated_by", "updated_at", "is_deleted"]
    list_filter = ["category", "project", "is_deleted"]
    search_fields = ["title", "body"]
    autocomplete_fields = ["project", "created_by", "updated_by"]
    inlines = [ArticleRevisionInline]
