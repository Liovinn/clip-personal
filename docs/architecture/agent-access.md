# API endpoints and agent access (MCP, API keys, OAuth, webhooks)

## Main endpoints

- `POST /api/process`: submit a video for processing.
- `GET /api/status/{job_id}`: poll job status and logs.
- `POST /api/edit`: apply AI video effects.
- `POST /api/subtitle`: generate and apply subtitles (auto-transcribes dubbed videos).
- `POST /api/hook`: add text hook overlays.
- `POST /api/translate`: AI voice dubbing via ElevenLabs.
- `GET /api/translate/languages`: supported dubbing languages.
- `POST /api/social/post`: post to social media (async upload).
- `POST /mcp`: MCP server (JSON-RPC), the pipeline as agent tools.
- `POST/GET/DELETE /api/keys`: user API keys (cloud mode, session JWT only).
- `DELETE /api/account`: erase the account and everything in it (GDPR art. 17).
- `GET/PUT /api/autopilot`: Autopilot settings, connected accounts, recent runs (cloud only).
- `GET /api/autopilot/videos`: latest uploads of the connected YouTube channel + what Autopilot did.
- `POST /api/autopilot/run`: clip one channel video now (`{video_id}`).

## Finished-clip delivery

`POST /api/jobs/{job_id}/download-all` prepares a cached ZIP and returns its size
and download URL. `GET /api/jobs/{job_id}/exports/{archive_id}` serves that exact
archive with FileResponse range support. Cloud links use a scoped, expiring HMAC
capability minted after the ownership check; session tokens never enter the URL.
The old authenticated GET download-all endpoint remains available. ZIP files
stay under the job's hidden `.exports` directory until normal job cleanup.
Only the selected delivered clip files are included; packaging never renders
video. File-version fingerprints prevent an edit from changing an active ZIP.

The self-host-only `POST /api/jobs/{job_id}/export-drive` asks Vast Cloud Copy to
upload an isolated ZIP folder to a configured Drive connection. It uses the
instance-scoped key already supplied by Vast, accepts no arbitrary source paths
or client-supplied credentials, and returns `submitted`, never `completed`.
Actual completion must be verified in Vast and Drive. Connection setup, HTTPS
gateway settings, and a route benchmark are in `docs/VAST_QUICKSTART.md`.

Optional self-host VPS delivery uses `POST /api/jobs/{job_id}/export-vps` to queue
the existing ZIP and GET on the same path to poll progress. Only a remote
SHA-256/size confirmation marks a transfer completed. `vps_exports.py` uses a
dedicated SSH upload key and pinned server host key from the private
`OPENSHORTS_VPS_CONFIG_B64` account setting. This setting is never returned by
the API. The receiver (`ops/vast/receive-vps.py`) accepts only the upload protocol,
publishes verified ZIPs atomically and returns scoped, expiring HTTPS links.
Downloads require Nginx secure_link validation; bearer links must be kept private.
Managed Cloud cannot enable this feature. Transcription, selection and rendering
do not call this delivery code.

## API keys (`cloud/api_keys.py`)

`osk_...` tokens, sha256-stored, created in the dashboard account page.
`cloud/auth.get_current_user_optional` accepts them (`Bearer osk_...` or
`X-API-Key`) and resolves the owner, so metering, entitlement, plan priority and
job ownership apply to agents with zero endpoint changes. Key management itself
refuses API-key auth: a leaked key cannot mint replacements.

## MCP server (`mcp_server.py`, always mounted)

Stateless Streamable-HTTP JSON-RPC at `/mcp`, no SDK dependency, ~3 methods + 8
tools. Each tool calls back into this same app in-process
(`httpx.ASGITransport`) forwarding the caller's auth headers, so it can never
drift from the REST behaviour. Cloud mode 401s without a resolvable user;
self-host stays BYOK-open.

## stdio transport (`mcp_stdio.py`)

The same `handle_message` / `call_tool` as a subprocess, for hosts that only
launch MCP servers as a command (e.g. Glama's Dockerfile deployments; a local
client can skip the web server). Two invariants:

- `sys.stdout` is swapped for stderr **before `app` is imported**: the pipeline
  prints everywhere and one stray line corrupts the JSON-RPC stream.
- The app's lifespan is entered (`router.lifespan_context`), which
  `ASGITransport` does not do on its own.

## OAuth for MCP clients (`cloud/mcp_oauth.py`, cloud mode only)

claude.ai and ChatGPT connect by URL, so the server publishes RFC 9728/8414
metadata under `/.well-known/`, accepts dynamic client registration
(`POST /oauth/register`, public clients, PKCE S256 mandatory) and bounces
`GET /oauth/authorize` to the dashboard consent screen (`#/oauth/authorize`),
because the session JWT lives in localStorage on the frontend host. `POST
/api/oauth/authorize` (session auth) mints the code; `POST /oauth/token` redeems
it by **minting an ordinary `osk_` key** named after the client and returning it
as the access token. No new auth path, no refresh tokens: the key shows up in
Account → API keys and revoking it disconnects the app. The `/mcp` 401 carries
`WWW-Authenticate: Bearer resource_metadata=...` so clients find the flow.
`oauth_codes` is in `USER_OWNED_TABLES`; `oauth_clients` deliberately not.

## Webhooks

`POST /api/process` takes `webhook_url` + optional `webhook_secret`
(HMAC-SHA256, `X-OpenShorts-Signature`). Validated with
`security_utils.assert_public_url` at submit AND at delivery (DNS rebinding).
Fired once per job from `run_job_wrapper` after the R2 archive so the payload can
carry durable download links; survives redeploys via the resume manifest.
`PUBLIC_API_URL` sets the absolute-URL base when behind a proxy.

Jobs sent with an `osk_` key (REST, MCP, OAuth clients) do not trigger the
clips-ready email: the caller polls or gets the webhook. The job records
`via_api_key` and the resume manifest carries it.

## Payment-required errors

Every 402 (`quota_exceeded`, `no_plan`) goes through `app.payment_required`: it adds `upgrade_url` (`/#/pricing?plan=starter&src=api`, which opens the Starter checkout) and repeats the link inside `message`, since MCP clients and SDKs often show only the message. The MCP `get_quota` tool returns the same `upgrade_url` for free or unentitled users, and the server instructions tell the agent to hand that link to the user.

