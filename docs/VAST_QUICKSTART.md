# OpenShorts on Vast.ai: repeatable personal setup

For this workflow: paste up to three video URLs, download the finished clips,
then destroy the rented instance. All three OpenShorts services run in one
Vast container. There is no nested Docker or Docker Compose requirement.

## 1. Save this template once

Create a custom template in Vast and name it **OpenShorts Personal — Browser**.
These access and delivery settings keep the existing GPU processing setup.

| Template field | Value |
| --- | --- |
| Docker image | `vastai/base-image:cuda-12.8.1-cudnn-devel-ubuntu24.04-py311` |
| Launch mode | **Entrypoint** (use the image's default entrypoint) |
| Environment variable | `NVIDIA_DRIVER_CAPABILITIES=compute,video,utility` |
| Environment variable | `PROVISIONING_SCRIPT=https://raw.githubusercontent.com/Liovinn/clip-personal/main/ops/vast/bootstrap.sh` |
| Environment variable | `ENABLE_HTTPS=true` |
| Environment variable | `ENABLE_AUTH=true` |
| Environment variable | `OPEN_BUTTON_PORT=1111` |
| Environment variable | `PORTAL_CONFIG="localhost:1111:11111:/:Instance Portal\|localhost:8080:18080:/:Jupyter\|localhost:5176:5175:/:OpenShorts"` |
| Environment variable | `VITE_EXTRA_ALLOWED_HOSTS=.trycloudflare.com` |
| Ports, TCP | **22, 1111, 8080, 5176** |
| On-start script / command override | Leave empty; preserve the image's default entrypoint |

Enter each environment variable in a separate Key/Value row, without including
`=` in either field. Most values need no quotes. For **PORTAL_CONFIG**, include
double quotes around the whole value because `Instance Portal` contains a space;
Vast's editor requires spaces to be quoted. Use plain `|` separators, without
backslashes. **OPEN_BUTTON_PORT** has key `OPEN_BUTTON_PORT` and value `1111`;
it tells Vast's Open button where the portal is listening.
[Copyable non-secret settings](../ops/vast/template.env.example).

For explicit Docker port options, these are:
`-p 22:22 -p 1111:1111 -p 8080:8080 -p 5176:5176`.
Vast assigns the external public ports. Do not publicly expose backend 8000,
renderer 3100, or the unauthenticated frontend 5175.

The image's native entrypoint initializes its portal, HTTPS, and authentication,
then downloads and runs `PROVISIONING_SCRIPT` after Supervisor starts.
The base image records successful provisioning and reuses it on later boots;
Supervisor automatically starts the installed OpenShorts services again.
Entrypoint mode avoids starting an extra Jupyter process alongside the base
image's own Jupyter service. The OpenShorts entry proxies external port 5176 to
the existing loopback frontend on 5175, without changing its processing services.

Keep `ENABLE_AUTH=true` and leave `AUTH_EXCLUDE` unset. Vast's Open button supplies
the access cookie; its default Basic Auth username is `vastai`, with the generated
instance token as the password. Keep that token out of GitHub and screenshots.

If provisioning fails or you want to run setup manually, use this in the
instance's root terminal after fixing the reported error:

```bash
curl -fL --retry 3 https://raw.githubusercontent.com/Liovinn/clip-personal/main/ops/vast/bootstrap.sh -o /tmp/openshorts-setup.sh && bash /tmp/openshorts-setup.sh
```

The installer keeps the base image's existing Supervisor configuration without
prompting. Its dependency pins keep language detection compatible with the
NumPy 1.x version required by MediaPipe on Linux.

The installer rejects overlapping runs. Installation failures are reported in
Vast's logs; do not wait indefinitely for the dashboard if setup has failed.

The explicit image tag selects **CUDA 12.8.1, cuDNN, Ubuntu 24.04, Python 3.11**.
It is a single pinned environment instead of a choice of arbitrary “12.8+” images.
The installer uses PyTorch 2.11.0 CUDA 12.8 wheels for RTX 50-series support and
checks CUDA kernels, a Whisper transcription, and H.264 NVENC encoding. It installs
OpenShorts, its renderer/browser, fonts, Deno for URL extraction, and pinned Node dependencies. The base
image must provide Node 22 or newer; a clear error is printed otherwise.

Sources: [Vast image tags and Python variants](https://github.com/vast-ai/base-image#available-image-variants),
[Vast startup behavior](https://docs.vast.ai/guides/templates/template-settings),
[PyTorch CUDA 12.8 wheels](https://pytorch.org/get-started/previous-versions/#v2110).

## 2. Choose an offer each session

| Filter | Starting value |
| --- | --- |
| GPUs | **1** |
| GPU | RTX 5060 Ti **16 GB**, or another supported NVIDIA RTX card |
| Rental | On-demand |
| Disk allocation | **50 GB** |
| System RAM | **16 GB minimum**, 32 GB if similarly priced |
| CPU allocation | At least 6–8 threads |
| Host | Verified; prefer 99.5%+ historical reliability |
| Upload / download price | Maximum **$10/TB** each; broaden to $20 if needed |

The instance's advertised disk capacity is not the allocation: set the disk
slider to 50 GB. Fifty GB is a starting estimate for a few ordinary 1080p
videos, not a guarantee for very long or 4K sources. URL clipping downloads the
full source and retains intermediate files on the server. GitHub/installer/model
downloads use bandwidth too. Choose more space if the source files are large.

Rent your saved template. Initial installation and first model downloads take
time and use rented resources. Follow progress in Vast's instance logs or terminal.
The installer prints **OpenShorts is ready** only after all three services respond.

## 3. Open in your browser

1. Wait for **OpenShorts is ready** in the instance logs.
2. Click **Open** on the Vast instance card to enter the Instance Portal.
3. Open its **OpenShorts** entry. The direct link uses HTTPS and the mapped
   external port for internal port **5176**. No local server or SSH window is
   needed for this route.
4. Use the authenticated direct link for large downloads. The optional Cloudflare
   link is another route to test, rather than an assumed speed improvement.

Vast uses its own TLS certificate. Follow the [Vast Jupyter TLS setup](https://docs.vast.ai/guides/instances/connect/jupyter)
if the browser does not trust it. Authentication must be active before sending
an API key or processing a URL. Confirm that an unauthenticated request to the
OpenShorts address is rejected or sent to the Vast login page.

If the portal's Caddy service fails, inspect its log. Do not work around it by
exposing the plain frontend; use the private SSH fallback below until fixed.

### If Vast says "Instance is running but has no web interface"

An Entrypoint-mode instance needs **OPEN_BUTTON_PORT=1111** so the Vast console
knows which port the Open button should use. The TCP port **1111** must also be
mapped in the template; **PORTAL_CONFIG** alone does not configure this button.
Saving a corrected template affects future launches, not the running rental.

For the current instance, inspect **IP / Port Info** on its card. Find the public
mapping for internal port **1111/tcp**, and open `https://PUBLIC_IP:MAPPED_PORT/`.
This does not bypass the gateway's authentication: the default username is
`vastai`; the password is the instance's `OPEN_BUTTON_TOKEN`. Retrieve it privately
in the instance's SSH shell with `printenv OPEN_BUTTON_TOKEN`; do not post the
token or any token-bearing URL in screenshots, chat, or the repository.

If that address does not respond, use SSH to check `supervisorctl status`,
`curl -I http://127.0.0.1:11111/`, and the Caddy/portal logs. This distinguishes
an Open-button setting from a service that did not start. Keep the rental intact
while diagnosing; there is no need to change video processing to investigate it.

### SSH fallback from Windows

Add your SSH public key to Vast. On the instance card, choose **Connect** and copy
its SSH host, user, and port. In PowerShell run the following, replacing the three
uppercase placeholders with those connection details:

```powershell
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -p SSH_PORT -L 15175:127.0.0.1:5175 SSH_USER@SSH_HOST
```

Keep that PowerShell window open, then visit:

**http://localhost:15175/#app**

Port 15175 avoids the local OpenShorts instance on port 5175. This tunnel carries
the dashboard and its backend requests. No public app URL or domain is required.
All three application services still bind to loopback. The SSH hostname and port can
change for each new rental; reuse the saved template but use the new connection
details. [Vast SSH guide](https://docs.vast.ai/guides/instances/connect/ssh)

## 4. Configure keys and clip your videos

1. Open **Settings** and enter your Gemini API key.
2. Open **Clip Generator → Video URL**, paste a source URL and choose **Generate Clips**.
3. Process one video at a time. The saved setup limits concurrency to one.
4. Choose **download all**. The server prepares a ZIP of the current clips;
   **preparing ZIP** ends when that ZIP is ready, before the file transfer.
5. Watch the browser's **Downloads** panel for bytes, speed, pause, resume, and
   completion. The app shows the ZIP size and hands the transfer to the browser
   instead of buffering the entire file in browser memory.
6. Verify the completed ZIP opens and the clips play correctly.

The server keeps the ZIP for retries and range requests until the job is purged
or the instance is destroyed. Clicking again reuses it unless the clip files
changed. Editing a clip creates a different archive and keeps the older one
available for an existing transfer. A deleted instance cannot resume a download.

### Save to Google Drive (optional)

This transfers **Vast -> Google Drive**, without routing video bytes through your
computer. It does not publish anything to social media or make files public.

1. In Vast **Settings -> Cloud Connections**, connect Google Drive. Vast recommends
   a dedicated Google account because the connection is at account level. Use a
   Secure Cloud host for Cloud Sync. [Vast Cloud Sync guide](https://docs.vast.ai/guides/instances/storage/cloud-sync).
2. Find the Drive connection's ID with `vastai show connections` in an authorized
   Vast CLI session. Add **OPENSHORTS_DRIVE_CONNECTION_ID** with that numeric ID
   to your private saved template before the next rental. This ID is not a key.
3. The instance supplies its own `CONTAINER_ID` and `CONTAINER_API_KEY`; the app
   never sends the key to the browser or puts it into the ZIP. No full-account
   Vast API key or Google token is requested by OpenShorts.
4. After processing, choose **save to Drive**. OpenShorts prepares the same ZIP
   and requests Vast Cloud Copy for a folder containing only that ZIP. Original
   videos, transcripts, metadata, and API keys are excluded.
5. **Upload requested is not upload complete.** Check the instance's Cloud Copy
   status in Vast for completion, then open Drive and verify the ZIP exists and
   has the expected size before destroying the instance. The app shows its
   destination under `OpenShorts/<job>/<export-version>/`.

The copy endpoint may reject the instance key depending on account/instance
permissions. If so, use **Cloud Copy** on the Vast instance card instead: choose
Instance To Cloud and your Google Drive connection, use the prepared ZIP's
isolated source directory under
`/workspace/clip-personal/output/<job>/.exports/drive/<archive-id>/`, and choose
the destination in Drive. Never copy the entire application folder.

Drive export is optional, available only in self-host mode, and starts only when
you click it. It is separate from video generation and never changes the rendered
clips. Vast bandwidth charges and your Drive storage limits still apply.

### Compare transfer routes on your next rental

Use the same prepared ZIP to compare the direct HTTPS link and the SSH fallback.
Pause other downloads/video previews while measuring. The optional helper below
reads only an 8 MiB range, displays transfer speed and checks that resume is
supported. For the gateway, supply `--username vastai`; it prompts for the
instance password without printing it or storing it in the repository.

```bash
python ops/vast/benchmark-download.py 'PREPARED_ZIP_URL' --username vastai
```

Use your local Python to measure the path to your computer; run it on Vast against
the loopback address to measure server delivery alone. Get the ZIP URL from the
browser's download details, and keep any signed query parameters private. Compare
with Drive's browser download speed after a verified server-to-Drive upload.
No speed improvement is guaranteed: host upload, routing, and your own connection
can each limit a transfer. Choosing another GPU does not fix network bandwidth.

For ordinary clipping and subtitles you need Gemini (or a separately configured
local LLM), not ElevenLabs, fal.ai, or Upload-Post. Social publishing is optional
in this version. ElevenLabs is only needed for dubbing/AI voiceovers; fal.ai is
needed for the optional AI Shorts generation feature. No API key belongs in Git
or in the public template.

The selected Whisper transcription model downloads during initial setup. A new browser
origin or cleared browser storage may require entering your key again. Some URL
sources restrict datacenter access or require login: renting a GPU does not
guarantee every website will allow its videos to be downloaded.

## 5. Finish the session

Download and check your finished files, or confirm the completed upload in Google
Drive, then choose **Destroy** in Vast.
Destroying deletes the instance's source videos, clips, installations and model
cache. Stopping retains storage and its charges. The next rental repeats setup
from your saved template and your GitHub version. [Vast storage lifecycle](https://docs.vast.ai/guides/reference/faq/instances)

## Restart, update, or troubleshoot

In the instance's root terminal:

```bash
# Status and logs (Ctrl+C stops following a log, not the app).
supervisorctl status
tail -n 80 /workspace/clip-personal/.cache/vast/backend.log
tail -n 80 /workspace/clip-personal/.cache/vast/renderer.log
tail -n 80 /workspace/clip-personal/.cache/vast/frontend.log

# Restart the running services without reinstalling.
bash /workspace/clip-personal/ops/vast/start-services.sh

# Pull your latest GitHub version, install changed dependencies, and restart.
bash /workspace/clip-personal/ops/vast/bootstrap.sh
```

Wait until active jobs finish before updating or restarting. Local source edits
are preserved: the updater stops if it finds uncommitted changes. Dependency
installs are reused when the setup inputs have not changed. If the GPU check
fails, read the error; do not assume that a visible GPU means CUDA/NVENC works.

The existing CUDA processing setup has run on a Vast GPU. These new browser-access
settings and the real Google Drive upload still need validation on the next
rental; no new paid instance is created by this update. Local checks cover ZIP
contents, caching, HTTP range requests, access checks, and the cloud-copy API
contract. They do not measure your next host's real network performance.

If setup reports that another program is listening while starting Supervisor,
the base image may already have a working Supervisor with a failed or stopped
optional service. OpenShorts checks the daemon's PID rather than treating those
other services as a daemon failure. It reuses the base image's Supervisor and
updates only the three OpenShorts services.
