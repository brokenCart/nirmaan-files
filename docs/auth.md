# Auth: Google ID token in, own JWT out

Sign-in, the campus domain gate, and how the SPA holds its tokens.

Read alongside [AGENTS.md](../AGENTS.md), which carries the rules that apply to every
change in this repository — the per-project/per-semester role model above all.

1. The SPA gets an ID token from Google Identity Services.
2. `POST /api/auth/google/` → `apps/accounts/services.py` verifies signature and audience, then
   independently checks `iss`, `email_verified`, and that the domain is exactly
   `pilani.bits-pilani.ac.in`.
3. A short-lived access token comes back in the response body; the refresh token is set as an
   **httpOnly cookie** scoped to `/api/auth/`.

The `hosted_domain` prop on the frontend Google button is a hint for the account chooser, **not a
security control** — anyone can post any token straight to the endpoint. `is_allowed_email` in
`apps/accounts/domain.py` is the real gate, and it is an exact domain match rather than a suffix
check so `evil-pilani.bits-pilani.ac.in` cannot slip through.

Only Pilani campus is allowed. Goa and Hyderabad are explicitly refused, and tests assert it.

Users match on Google `sub` first, then email — which lets a lead add someone by email before they
have ever signed in, with the placeholder row adopted on first login.

On the client, the access token lives in a module variable in `src/api/client.ts`, never in
`localStorage`. A reload therefore starts signed-out until `restoreSession()` trades the refresh
cookie for a new token. Concurrent 401s share one in-flight refresh, because refresh tokens rotate
and a losing racer would present an already-blacklisted token.
