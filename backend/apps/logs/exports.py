"""Spreadsheet exports. The only module that imports openpyxl."""

import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter

from apps.projects.models import Role

HEADERS = ["Member", "Email", "Role", "Visits", "Meetings", "Total"]


def attendance_workbook(project, semester, rows) -> bytes:
    """Render `rows` from :func:`apps.logs.stats.attendance_for` as .xlsx bytes.

    Returns bytes rather than a workbook so callers need no openpyxl import and
    the file is fully built before any of it reaches the response.
    """
    workbook = Workbook()
    sheet = workbook.active
    # Excel rejects sheet names over 31 chars or containing []:*?/\\ — the
    # project name is user-supplied, so neither is guaranteed.
    sheet.title = "Attendance"

    sheet.append([f"{project.name} — attendance"])
    sheet["A1"].font = Font(bold=True, size=14)
    # The term is named on the sheet because counting restarts each semester:
    # a file that just says "attendance" invites someone to read one term's
    # totals as the whole of a member's contribution.
    sheet.append([f"{semester.name}" if semester else "No semester on record"])
    sheet["A2"].font = Font(bold=True)
    sheet.append(["Published entries only; drafts and removed entries are not counted."])
    sheet.append([])

    header_row = sheet.max_row + 1
    sheet.append(HEADERS)
    for cell in sheet[header_row]:
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="center")

    role_labels = dict(Role.choices)
    for membership in rows:
        user = membership.user
        sheet.append(
            [
                user.full_name or "",
                user.email,
                role_labels.get(membership.role, membership.role),
                membership.visits,
                membership.meetings,
                membership.visits + membership.meetings,
            ]
        )

    # Freeze the header so the roster stays readable while scrolling.
    sheet.freeze_panes = sheet.cell(row=header_row + 1, column=1)

    for index, header in enumerate(HEADERS, start=1):
        longest = max(
            [len(header)] + [len(str(cell.value or "")) for cell in sheet[get_column_letter(index)]]
        )
        sheet.column_dimensions[get_column_letter(index)].width = min(longest + 4, 40)

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
