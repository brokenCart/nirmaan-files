from django.contrib import admin

from .models import Reimbursement


@admin.register(Reimbursement)
class ReimbursementAdmin(admin.ModelAdmin):
    list_display = ["title", "project", "semester", "status", "submitted_by", "created_at"]
    list_filter = ["status", "project", "semester", "is_deleted"]
    search_fields = ["title", "description", "review_note"]
    autocomplete_fields = ["project", "submitted_by", "reviewed_by"]
    # Set by `record_decision` through the review endpoint, which is where the
    # separation-of-duties rule lives. Editable here would make the admin a way
    # around it that leaves the same audit trail as a legitimate review.
    readonly_fields = ["reviewed_by", "reviewed_at", "created_at", "updated_at"]
