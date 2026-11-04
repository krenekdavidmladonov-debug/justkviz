# JustKvíz custom domain

The custom address `https://justkviz.cz` serves the existing V2 Hosting site
`justkviz-v2` in Firebase project `filmovy-kviz-v2-staging`. It uses the same
backend, accounts, memberships, quiz content and event records. Existing Firebase
Hosting addresses remain available for saved links and rollback.

## Registration email links

`functions/src/email/config.ts` accepts only these exact server-configured origins:

- `https://justkviz.cz`
- `https://justkviz-v2.web.app`
- `https://filmovy-kviz-v2-staging.web.app`

Subdomains, lookalikes, credentials, alternate ports, trailing slashes, paths,
queries and fragments are rejected. This origin allowlist still requires the
existing explicit V2 registration email activation. It does not activate email in
another project or change recipient eligibility.

The private `deliverEmailTask` worker selects the address through
`EMAIL_PUBLIC_ORIGIN`. Switching it to `https://justkviz.cz` affects newly rendered
registration-management links and the public email logo. Capabilities remain in
URL fragments; they never enter the logo URL. Cancellation messages keep their
existing behavior without a management link. Already sent messages retain their
original working address.

Only `deliverEmailTask` needs a Functions source update for this guard. Its release
must preserve the existing environment except `EMAIL_PUBLIC_ORIGIN`, runtime
identity, secret bindings and versions, private invocation policy, activation
cutoff, recipient policy and queue configuration. A source-only update does not
switch generated links; an environment-only update before deploying the updated
guard would reject the new origin.

Record the current source generation and worker configuration before deploying.
Publish the checked source and replace only that origin in the existing environment
map, then verify the deployed source, environment, private IAM and unchanged queue.
A rollback restores the recorded source and former origin together. It does not
rewrite registrations, replay the outbox or send test messages to real contacts.

Focused offline coverage: `tests/emailActivation.test.ts`,
`tests/transactionalEmail.test.ts` and `tests/gmailDelivery.test.ts`.

## Google Drive and shared links

Public registration, management and invitation links use the exact canonical
origin in V2. Demo emulator links keep their validated local origin. Private
capabilities remain in URL fragments. Projector windows retain their opener's
origin for BroadcastChannel communication.

The existing media OAuth client and Picker key in `justkviz-media-v2` retain
their old entries and add only the owned canonical origin and callback
`https://justkviz.cz/admin/settings/drive/callback`. API restrictions and OAuth
scopes are unchanged. Only `beginDriveConnection` and `completeDriveConnection`
need the new callback runtime setting plus the exact origin allowlist update.
Their deployed source, identities, secrets and IAM are recorded before release.

Legacy settings direct a new connection to canonical settings before creating
sessionStorage state. Existing connected operations remain available. Auth
sessions are origin-specific; users may need to sign in on the new domain.
An OAuth attempt already in progress during the switch may need to be retried.
Rollback restores both recorded Function sources and redirect settings together;
it does not disconnect accounts or delete media.
