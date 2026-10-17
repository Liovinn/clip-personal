# OpenShorts on Vast.ai: repeatable personal setup

For this workflow: paste up to three video URLs, download the finished clips,
then destroy the rented instance. All three OpenShorts services run in one
Vast container. There is no nested Docker or Docker Compose requirement.

## 1. Save this template once

Create a custom template in Vast and name it **OpenShorts Personal — CUDA 12.8**.

| Template field | Value |
| --- | --- |
| Docker image | `vastai/base-image:cuda-12.8.1-cudnn-devel-ubuntu24.04-py311` |
| Launch mode | **Jupyter + SSH** |
| Environment variable | `NVIDIA_DRIVER_CAPABILITIES=compute,video,utility` |
| Environment variable | `PROVISIONING_SCRIPT=https://raw.githubusercontent.com/Liovinn/clip-personal/main/ops/vast/bootstrap.sh` |
| Additional app ports | None; access the app through SSH |
| On-start script | Paste the block below |

```bash
/opt/instance-tools/bin/entrypoint.sh
```

Use the existing Jupyter/SSH port settings supplied by Vast's template editor.
Set On-start to the command above: it initializes the selected Vast base image,
which then downloads and runs `PROVISIONING_SCRIPT` after Supervisor starts.
The base image records successful provisioning and reuses it on later boots;
Supervisor automatically starts the installed OpenShorts services again.

If provisioning fails or you want to run setup manually, use this in the
instance's root terminal after fixing the reported error:

```bash
curl -fL --retry 3 https://raw.githubusercontent.com/Liovinn/clip-personal/main/ops/vast/bootstrap.sh -o /tmp/openshorts-setup.sh && bash /tmp/openshorts-setup.sh
```

The installer rejects overlapping runs. Installation failures are reported in
Vast's logs; do not wait indefinitely for the dashboard if setup has failed.

The explicit image tag selects **CUDA 12.8.1, cuDNN, Ubuntu 24.04, Python 3.11**.
It is a single pinned environment instead of a choice of arbitrary “12.8+” images.
The installer uses PyTorch 2.11.0 CUDA 12.8 wheels for RTX 50-series support and
checks CUDA kernels, a Whisper transcription, and H.264 NVENC encoding. It installs
OpenShorts, its renderer/browser, fonts, and pinned Node dependencies. The base
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

## 3. Connect privately from Windows

Add your SSH public key to Vast. On the instance card, choose **Connect** and copy
its SSH host, user, and port. In PowerShell run the following, replacing the three
uppercase placeholders with those connection details:

```powershell
ssh -N -p SSH_PORT -L 15175:127.0.0.1:5175 SSH_USER@SSH_HOST
```

Keep that PowerShell window open, then visit:

**http://localhost:15175/#app**

Port 15175 avoids the local OpenShorts instance on port 5175. This tunnel carries
the dashboard and its backend requests. No public app URL or domain is required.
All three application services bind to loopback. The SSH hostname and port can
change for each new rental; reuse the saved template but use the new connection
details. [Vast SSH guide](https://docs.vast.ai/guides/instances/connect/ssh)

## 4. Configure keys and clip your videos

1. Open **Settings** and enter your Gemini API key.
2. Open **Clip Generator → Video URL**, paste a source URL and choose **Generate Clips**.
3. Process one video at a time. The saved setup limits concurrency to one.
4. Download the clips you want and verify the downloads play correctly.

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

Download and check your finished files, then choose **Destroy** in Vast.
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
supervisorctl restart 'openshorts-*'

# Pull your latest GitHub version, install changed dependencies, and restart.
bash /workspace/clip-personal/ops/vast/bootstrap.sh
```

Wait until active jobs finish before updating or restarting. Local source edits
are preserved: the updater stops if it finds uncommitted changes. Dependency
installs are reused when the setup inputs have not changed. If the GPU check
fails, read the error; do not assume that a visible GPU means CUDA/NVENC works.

This setup is prepared for Vast's Linux x86_64 CUDA image. Local source builds,
script checks and CI validate the code; the first real Vast GPU launch still
needs a smoke test with your chosen offer.
