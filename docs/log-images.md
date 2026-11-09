# Photos, receipts and videos

How media on MOVs, MOMs and reimbursements is stored and served, and how to connect real Google
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

The project's `FOLDER` resource is not involved, because a resource has no semester.

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

**Drive is outside these rules.** Privacy is enforced by the app, not by Drive. A file reaches Drive
when its entry is saved, draft or not, and anyone with access to the folder can open it there.
`LogComposer` warns about this above the pickers, so a private draft is not mistaken for private
media.

### Videos

MOVs and MOMs can carry up to **3 videos**, MP4, MOV or WebM, up to **500 MB** each. Reimbursements
cannot. The edit rule is the entry's, and each video lands in the entry's term folder.

The browser sends a video **in 8 MB chunks to our backend**, which relays each to a resumable Drive
session (`apps/drive/video.py`). Google documents browser uploads only for sessions the browser
started, so handing a server-started session over would be untested ground. Relaying also keeps the
session URL, which is a credential, out of the browser, and the backend learns the file id itself
rather than trusting one the client sends. Each chunk's reply reports how far the upload has really
got, and the client carries on from there, which is what makes retries safe.

**"Background" means within the tab.** `videoUploads.ts` is a module-level queue, so uploads continue
after the form closes and between screens, and `VideoUploadPanel` shows progress and warns before
the tab closes. Closing the tab stops the upload, and it has to be restarted from the entry.

A video is hidden until its last chunk lands. Playback streams through the backend with `Range`
support so seeking works. It holds a server connection for as long as someone is watching, so video
is the part of this app to watch if the server struggles. Any reverse proxy must accept 8 MB bodies.

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

Any reverse proxy in front of the app must accept request bodies over 10 MB, for images.
