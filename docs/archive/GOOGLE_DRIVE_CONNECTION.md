# Private Google Drive connection

This source slice prepares an owner connection to a personal Gmail/Googlemail
account and selection of one private My Drive folder from Settings. Cloud
activation, OAuth client creation, secret installation and deployment are separate
operator actions requiring explicit approval. The folder created through the chat
connector is preparation only: that connector's authorization does not authorize
the V2 application. No Drive file import, media migration, backup job, file upload
or YouTube ingestion is implemented by this connection.

## Authorization and transport

Every callable checks fresh Firebase Auth and current active server-managed
membership. Connection operations require the current owner membership plus
`users.manage` and `quiz.media.upload`; neither a legacy Auth claim nor the owner
label alone grants authority. The connection belongs to the authenticated Firebase
UID. A Google account grant never grants Firebase membership or access to quiz
answers, event contacts or public projections.

The requested OAuth scope is only
`https://www.googleapis.com/auth/drive.file`. OAuth uses the server authorization
code flow with PKCE S256, an unpredictable state, a short expiry and single-use
server state bound to Firebase UID and membership version. The callback route is
`/admin/settings/drive/callback`. The browser checks the pending state and identity,
removes callback query parameters from history immediately, and submits the code
to the trusted callable. The server rechecks current authorization before saving
the result. Codes, verifier plaintext, tokens and provider responses must never
enter logs, errors, URL navigation state or persistent browser storage.

The Google account is checked through Drive's account metadata, and only personal
`gmail.com`/`googlemail.com` accounts are accepted. Folder selection is verified
again by the server: exact ID, folder MIME, not trashed, owned by this account,
outside a Shared Drive, writable, and no sharing or other owner/permission. A
Picker selection or a browser-supplied folder name is not authoritative. Folder
privacy is an observed property at selection; it cannot stop an
account owner changing Drive sharing later. Future file operations must repeat
their relevant checks.

## Server-only records and secrets

| Path | Ownership and contents | Browser access |
| --- | --- | --- |
| `driveConnections/{uid}` | Server connection status, bounded account/folder metadata and encrypted refresh-token envelope | Denied, including self and active owners |
| `driveOAuthStates/{stateHash}` | Hashed state identity, Firebase UID, membership version, expiry, one-time consumption and protected PKCE verifier | Denied, including nested paths |

The existing recursive default-deny Rules protect both collections and all their
children. No client Rules grant is needed. Settings obtains only an allowlisted
status response through a callable. Access tokens are issued to the owner browser
only for the Google Picker session; they are short lived and kept in memory.
That bearer token has the OAuth client's `drive.file` grant, so a folder-only Picker
view is a usability constraint, not a narrower OAuth scope. The browser never
receives a refresh token, client secret or keyring.

Status reads describe the last stored connection; they do not make a Google
request to prove the grant or folder remains valid. The OAuth state's expiry is
checked by server code in milliseconds. No automatic Firestore TTL policy or
cleanup job is installed by this source; retained expired/consumed state is still
server-only and cannot be exchanged again. Set an explicit bounded retention and
cleanup policy before sustained rollout rather than assuming expiry deletes it.

Use a dedicated **media Google Cloud project**, separate from the Firebase runtime
project, transactional Gmail's OAuth project and every V1 project. Put the media
OAuth web client, consent configuration, Drive/Picker APIs and browser API key in
that media project. A second OAuth client inside the Gmail or Firebase project is
insufficient isolation: Google's revocation invalidates the user's granted scopes
and access/refresh tokens across all clients registered in the same project.
The media project must contain no unrelated OAuth clients or grants. This is a
required activation prerequisite, not a project created by this preparation.
[Google's token-revocation contract](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)
documents the project-wide effect. Never reuse Gmail refresh tokens, Gmail vault
keys, chat connector credentials or V1 credentials.

Refresh tokens and PKCE verifiers use authenticated
AES-256-GCM encryption with context binding and random nonces. The keyring format
is `{ "activeKeyId": "<id>", "keys": { "<id>": "<base64-32-byte-key>" } }`.
Create the key outside Git, keep the keyring in Secret Manager, and retain old
decryption keys until every envelope has been replaced or removed. IDs, ciphertext,
nonce and tag do not authorize a client to read these records. Restrict runtime
Secret Manager IAM to the dedicated endpoint identity and only its required
Drive secrets. Do not put OAuth secrets or raw tokens in `.env`, tracked fixtures,
operator reports, screenshots or deployment output.

Disconnect removes the local connection and attempts revocation in the separate
media OAuth project. Project separation is what protects Gmail and Firebase OAuth
grants from this revocation; a dedicated client alone does not. Retain server
revocation so disconnect can withdraw the media application's provider access,
rather than only discarding a credential locally. Provider failure must not make
the local encrypted credential available again. Disconnect does not delete or share the folder or change quiz
media. Operators can also revoke the app in their Google account. Revocation,
expiry and an invalid grant require an explicit reconnection.

## Why selecting the existing folder is necessary

`drive.file` is per application and per file. Google permits files created with
the app or explicitly opened/shared with the app through its picker. Creating a
folder with another client, knowing its ID, being its human owner or pasting its
URL does not grant the V2 client access. Select the prepared private folder in the
V2 application's Google Picker after connecting the intended Google account.
Selecting a folder must not be treated as consent to read all existing child
files recursively. A later import feature needs explicit file selection or files
created by this application, plus server validation of each requested operation.
Do not widen the scope to full Drive to work around this restriction.
[Google's scope guide](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
defines this per-file grant and recommends combining it with Picker.

## Exact activation preparation

The bounded Hosting/Functions release is enumerated in
[`tools/drive/deployment-manifest.json`](../tools/drive/deployment-manifest.json).
It does not authorize deploying every Function exported from this repository.

1. After explicit approval, create or identify a dedicated **media Google Cloud
   project**, separate from the existing V2 Firebase runtime project, the OAuth
   project used by transactional Gmail, and V1. Do not place unrelated OAuth clients
   in it. Verify and record that separation without exposing credentials before
   enabling the connection. Configure the media project's **Web application**
   OAuth client and consent screen there; do not add this client to the Gmail or
   Firebase runtime project. Functions, Firestore and Hosting stay in the existing
   V2 Firebase runtime project; this separation does not move application data.
   For a personal Gmail account, configure an External consent audience and add
   only the intended operator as a test user while the app remains in Testing.
   Request only `drive.file`; do not add Gmail or broad Drive scopes.
2. Register exactly
   `https://justkviz-v2.web.app/admin/settings/drive/callback` as the authorized
   redirect URI. Add `https://justkviz-v2.web.app` as the authorized JavaScript
   origin for the browser Picker integration. Additional origins or local callback
   URIs must be explicit entries for a separately approved environment, not a
   wildcard. The URI registered with Google and sent by the server must match.
   [Google's web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server)
   describes redirect matching and the server code exchange.
3. Enable **Google Drive API** and **Google Picker API** in that separate media
   project. Use the media project's numeric project number as the Picker App ID;
   it must match the media OAuth client's project, not the Firebase runtime project.
   Create the dedicated browser Picker API key in the media project with
   website restrictions for `https://justkviz-v2.web.app/*` and, as required by
   Google's iframe integration, `https://docs.google.com/*`. Restrict the key's
   APIs to Google Picker API and Google Drive API. Keep development keys separate.
   A browser API key is public configuration; API and referrer restrictions still
   matter. Follow the [official Picker setup](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample)
   if Google's required iframe origins change.
4. Install the media client's `DRIVE_OAUTH_CLIENT_SECRET` and independent
   `DRIVE_TOKEN_KEYRING` through the existing V2 runtime's Secret Manager, with the
   endpoint runtime identity's least required access. Do not reuse the Gmail vault.
   Configure `DRIVE_OAUTH_CLIENT_ID`, `DRIVE_OAUTH_REDIRECT_URI`,
   `DRIVE_PICKER_API_KEY` and `DRIVE_PICKER_APP_ID`. Set
   `DRIVE_CONNECTION_ENABLED=true` only in an explicitly approved release with
   the required secret bindings and verified OAuth project separation. The Picker
   App ID identifies the media project; the Function runtime remains on the exact
   existing V2 Firebase project allowlist. Missing or malformed configuration remains
   unavailable. The real adapter refuses local emulators and any project outside
   the existing isolated V2 allowlist.
5. Approve an exact Functions/Hosting release after reviewing the local evidence.
   Then connect the intended personal account in Settings and explicitly select
   the prepared private folder using Picker. Check the displayed account and
   folder, safe status, disconnect and reconnection. Do not paste secrets or
   callback codes into chat. Confirm that no unrelated folder, file or sharing
   change occurred. These operator steps are not executed by this document.

### OAuth Testing is temporary

Google documents that an External OAuth app in **Testing** issues refresh tokens
which expire after seven days unless it requests only basic identity scopes.
`drive.file` is not that exception. An initial connection in Testing therefore
does not prove durable unattended access. Moving the consent app to the appropriate
published state is an operator decision subject to Google's current consent and
verification requirements; publishing does not guarantee a refresh token remains
valid forever. Revocation and other Google expiry conditions still apply.
This is an operator rollout limitation, not an additional end-user warning on every
Settings visit. Source checked 2026-10-16:
[Google OAuth refresh-token expiry](https://developers.google.com/identity/protocols/oauth2#expiration).

## Local verification and rollout limits

Local provider tests use synthetic account metadata, folder IDs, tokens, OAuth
codes and an isolated vault. They must never call Google, use the real folder or
read cloud credentials. Firestore Rules tests use only a loopback emulator with
the `demo-filmovy-kviz-v2` project. `tests/driveConnection.rules.test.ts` proves
get/list/create/update/delete denial for anonymous users, the connection owner,
legacy admin claims, an active administrator and an active owner, including
encrypted nested secrets. Privileged fixtures have real synthetic current
memberships with all permissions; the test does not assume claims confer access.

Before committing security-boundary changes, run `pnpm check` and
`pnpm test:rules` under the repository workflow and record the actual outcome.
Additional provider/callable/browser contract checks should cover wrong UID,
revoked membership/version, expired and replayed state, malformed or wider grants,
folder privacy failures, invalid refresh grants and secret-free status/errors.
Local passing evidence is not evidence of a live Google grant. No cloud OAuth
grant, endpoint activation or deployment is authorized by this preparation.
