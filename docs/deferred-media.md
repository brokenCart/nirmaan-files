# Deferred: photos and video

Why entries are text-only, and the Drive question that has to be settled first.

Read alongside [AGENTS.md](../AGENTS.md), which carries the rules that apply to every
change in this repository — the per-project/per-semester role model above all.

MOVs and MOMs are **text-only for now**. Media was deliberately cut from v1.

A Google service account has **no Drive storage quota of its own**, so uploading into a folder that
lives in someone's *My Drive* fails with `403 storageQuotaExceeded` regardless of the owner's free
space. It only works against a **Shared Drive** (org-owned, drawn from BITS's pooled storage) or
via OAuth delegation as a real user holding a refresh token. Which of those applies to Nirmaan's
existing project Drives was not settled, so uploads were dropped rather than guessed at.

The agreed design for when it lands: one Drive folder per project; the backend grants each member's
`@pilani` address read access via the Drive API on join; the SPA embeds Drive preview/thumbnail
URLs so Google enforces auth against the viewer's own session. No media bytes flow through our
server, and the external PR team can open the same folder natively.

The seam is the project's `FOLDER` resource — `Project.drive_folder_url` used to be it and was
removed in `projects.0003` (see [*Resource links*](resources.md)). Note that nothing constrains a project to one
`FOLDER` row, so that work has to decide which one it uploads into rather than assuming.

**The same question blocks reimbursement receipts**, which are the other place users will expect to
attach a file. Whatever resolves the quota question resolves both, and they should land together
rather than growing two upload paths — see [*Reimbursements*](reimbursements.md) for the child-table shape that side
expects.
