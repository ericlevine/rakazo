# GCP IAP collaboration deployment

This fork can treat a verified Google Cloud Identity-Aware Proxy assertion as
the admission boundary for a Rakazo deployment. IAP controls who can reach the
site; Rakazo verifies the signed assertion, creates or links the local account,
and issues its ordinary session cookie.

## Trust and account model

- Rakazo verifies `X-Goog-IAP-JWT-Assertion` against Google's IAP JWKS.
- The token must have issuer `https://cloud.google.com/iap` and exactly match
  `IAP_AUDIENCE`. The unsigned email convenience header is never trusted.
- The stable IAP `sub` claim is stored as a `google-iap` Better Auth account.
- A pre-existing Rakazo account with the same verified email is linked. An
  account already bound to a different IAP subject is rejected.
- IAP identities bypass Rakazo's password-signup policy intentionally: the IAP
  IAM policy is the deployment's allowlist. Password signup behavior is unchanged.
- The first admitted identity owns the deployment. Additional admitted
  identities join the owner's default organization and space as members.
  Agents are private by default; an owner can make an agent workspace-visible
  so other space members can use its shared conversation. Human messages store
  and display their authenticated author so collaborators can distinguish turns.
  Groups have the same private/workspace visibility boundary. A workspace group
  may contain only workspace agents; members can chat in its live thread while
  only its creator can manage it. The roster separates Personal and Workspace
  conversations, and an agent's New thread action creates a one-agent group
  with the agent's visibility.
  Agent management,
  user memory, notification settings, and personal credentials remain
  user-scoped.

Tool activity is visible to everyone who can view the conversation. Each bot
reply keeps tool calls collapsed by default; opening the summary reveals the
individual tools, and opening a tool reveals its input and output. These details
are stored in the existing thread event/message stream so they update live and
survive refreshes. Before persistence, known run secrets and values under
credential-like keys are redacted, binary payloads are replaced with metadata,
and unusually large values are truncated. Authorization is unchanged: private
conversation details remain private, and workspace conversation details follow
the workspace's existing membership checks.

Only grant `roles/iap.httpsResourceAccessor` to named users or a controlled
Google group. Do not grant it to `allAuthenticatedUsers`.

## Network shape

The VM has no public IP. Docker publishes the web and API ports on loopback.
Host nginx listens on port 8080 and routes `/api`, `/rpc`, and `/health` to the
API and all other paths to the web container. The only VPC ingress to 8080 is
from Google's load-balancer and health-check ranges. HTTPS terminates at the
global external Application Load Balancer. IAP protects the application
backend. `/novnc/*` uses a separate backend without IAP because iframe scripts
and WebSockets cannot complete an IAP OAuth redirect; Rakazo protects that path
with signed, short-lived view/control capabilities and rejects unsigned,
expired, or altered targets. No other application path bypasses IAP. IAP TCP
forwarding to SSH remains the administrative path.

For a team-wide model credential, set the matching server-side key (for
example `OPENAI_API_KEY`) together with `PI_DEFAULT_PROVIDER` and
`PI_DEFAULT_MODEL`. It is available to all admitted users for inference but is
never returned to the browser. UI-connected model credentials remain personal.

Run `infra/gcp/iap/configure-host-proxy.sh` as root on the VM, then run
`infra/gcp/iap/provision-load-balancer.sh` from an authenticated workstation.
The latter prints the exact audience and load-balancer IP. Keep real project
IDs, identities, hostnames, OAuth credentials, and audience values out of Git.

Set these untracked deployment environment values:

```dotenv
BETTER_AUTH_URL=https://rakazo.example.com
WEB_ORIGIN=https://rakazo.example.com
API_URL=https://rakazo.example.com
RAKAZO_HOST=rakazo.example.com
IAP_AUDIENCE=/projects/123456789/global/backendServices/987654321
```

Point DNS at the printed global IP. A Google-managed certificate becomes
active only after public DNS resolves correctly. Never expose the API port or
web container directly in a firewall rule.

## Build and deploy

Use a commit SHA, never a moving tag:

1. Run `pnpm test`, `pnpm check`, and `pnpm lint` with the repository-declared
   pnpm version.
2. Push the feature branch to the fork. Do not open an upstream PR.
3. Dispatch `publish-server-image.yml` on that branch and wait for success.
4. Back up the database/data disk. Preserve the existing `.env` and secrets.
5. Set `RAKAZO_IMAGE` to the fork's GHCR app path and
   `RAKAZO_IMAGE_TAG=sha-<40-character-commit>`.
6. Add the five HTTPS/IAP values above and recreate the API, web, worker, and
   supervisor services. Database migrations run in the API startup command.
7. Verify health, IAP redirect, account linking, two-user shared-space access,
   model credentials, computer startup, logout/relogin, and VM reboot recovery.

Rollback means restoring the prior pinned image values and recreating the
services. Do not delete Compose volumes.

## Rebase/replay procedure

Keep this customization as a small feature branch with separate commits for
authentication/collaboration and deployment documentation. To update it:

1. Fetch `upstream` and rebase the branch onto `upstream/main`.
2. Resolve shared database bootstrap changes first, then Better Auth plugin and
   environment wiring, then the web session bootstrap. Replay the optional
   tool-call fields in the shared message contract before the core event
   projection, executor audit payload, and web/mobile disclosure components.
3. Run Prisma generation if the upstream schema or generated client changed.
4. Run the focused auth, database, API, and web tests, followed by the full
   test/type-check/lint suite.
5. Build a new pinned-SHA image and deploy it through the same backup and
   verification sequence. Existing `google-iap` account links and memberships
   remain in PostgreSQL.

No changes need to be proposed to the public upstream repository.
