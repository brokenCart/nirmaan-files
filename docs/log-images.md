# Photos and receipts

How images on MOVs, MOMs and reimbursements are stored and served, and how to connect real Google
Drive storage.

Read alongside [AGENTS.md](../AGENTS.md), which carries the rules that apply to every
change in this repository — the per-project/per-semester role model above all.

Timeline photos and reimbursement receipts share one path in `apps/drive/images.py`, and each owner
brings its own model and its own edit rule. This file describes photos; receipts differ only where
[*Reimbursements*](reimbursements.md) says so.

An entry can hold up to **10 photos**, JPEG, PNG or WebP, up to **10 MB** each. The type is read
from the file's bytes, never its name. SVG is refused because it can carry script and these are
served from our own origin.

**Writes follow the entry's edit rule** (`_assert_can_edit`): only the author, only as a member this
semester, only in the open term. Adding or removing a photo *is* editing the entry. Staff who object
delete the whole entry, as they would for its text.

**Removing is soft.** The `LogImage` row is flagged and the file stays in Drive, the same way a
deleted entry stays in the table. Something that must truly be gone has to be deleted in Drive by
hand.

### Storage layout

`apps/drive/storage.py` is the only code that knows about Drive. Folders are created on first upload
and recorded in `DriveFolder`, so a term needs no setup:

```
<DRIVE_ROOT_FOLDER_ID>/
  Shiksha/
    2026-27 Semester 1/
      2026-08-01 MOV Saturday session 3fa9c1d2.jpg
    Receipts/
      2026-27 Semester 1/
        2026-08-02 Bus fare 91bc0e77.jpg
```

The folder follows the **entry's** semester, not today's date. An entry cannot change semester once
filed, so its photos never end up in the wrong folder.

Receipts sit in their own tree because a claim is private to its submitter and project staff. **Share
a term's photo folder if someone needs it, never the whole project folder**, which includes receipts.

This replaces the single-folder-per-project plan in the old deferred design. The project's `FOLDER`
resource is not involved, because a resource has no semester.

### Serving

Every view goes through `GET /api/log-images/<id>/content/` (or `/api/reimbursement-receipts/…`), so drafts and removed photos stay as
private in the app as the entries they belong to. Sharing a Drive folder with every member, the
earlier plan, would have exposed both.

An `<img>` tag cannot send the bearer token, so the serializer issues **signed URLs** instead, valid
for one to two hours and tied to that route, so a photo's signature cannot open a receipt. The expiry is rounded to the hour so the URL stays the same across feed
refetches and the browser cache works. Only a serializer that has passed `visible_to` issues one.
Anyone holding a URL can use it until it expires. Deletion is still checked per request.

Thumbnails use Drive's own `thumbnailLink`, sized to 640px. Drive has none for a short while after
upload, and the original is served until it does.

### Connecting Google Drive

With `DRIVE_ROOT_FOLDER_ID` empty, development stores files in `backend/media/drive/`, and production
stays up with the photo picker hidden (`Project.image_uploads_enabled`). These two settings are
optional in production, unlike every other secret, so that deploying does not depend on having Drive
access first.

Either way, `DRIVE_CREDENTIALS_JSON` holds a JSON document on one line, in single quotes
(`jq -c . key.json`). A personal Drive folder with a service account **will not work**: a service
account has no storage quota, so uploads fail with `403 storageQuotaExceeded`.

**Option A: Shared Drive with a service account (preferred).** Files belong to the organisation, so
they survive anyone graduating.

1. At console.cloud.google.com, pick or create a project and enable the **Google Drive API**.
2. Under *IAM & Admin → Service Accounts*, create one, then *Keys → Add key → JSON*. That file is
   `DRIVE_CREDENTIALS_JSON`.
3. In Drive, create a Shared Drive and add the service account's email as **Content Manager**. If it
   is refused as an outside member, a Workspace admin has to allow it.
4. Open the Shared Drive. The last part of the URL is `DRIVE_ROOT_FOLDER_ID`.

**Option B: a dedicated Google account.** Use this if BITS does not allow Shared Drives. Photos use
that account's storage, and uploads stop if the account is ever suspended or deleted.

1. In the same Cloud project, enable the Drive API and create an **OAuth client** of type *Desktop*.
   Set the consent screen to **In production**, because tokens from one left in *Testing* expire
   after 7 days.
2. Run `gcloud auth application-default login --client-id-file=client.json
   --scopes=https://www.googleapis.com/auth/drive` while signed in as that account. The resulting
   `application_default_credentials.json` is `DRIVE_CREDENTIALS_JSON`.
3. Create a folder in that account's Drive. The last part of its URL is `DRIVE_ROOT_FOLDER_ID`.

Any reverse proxy in front of the app must accept request bodies over 10 MB.
