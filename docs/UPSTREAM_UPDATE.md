# Clipedit clipping update

Selectively backported from OpenShorts main `3e45b458867c1d90df8fbb824f7d09ab9b499bc7`.

Included: screencast/presenter and face-inset framing fixes; lazy hook-only
intermediates with on-demand editor recovery; shared NVENC slots for job
processes; connect-time URL checks; renderer job-id validation; and the
optional Rust/CUDA single-pass renderer with its fallback and regression tests.

The Indonesian interface, Gemini/Whisper configuration, source submission,
cached ZIP downloads and VPS exports are preserved. Normal use needs no new
settings. `HOOK_LAZY=0` restores eager hook intermediates; `JOB_NVENC_SLOTS=0`
disables the job encoder limiter.

The new GPU path is opt-in. On Vast, add environment variable key `GPU_RENDER`
with value `1`, then run the existing bootstrap after active jobs finish.
The first setup installs Rust/build libraries and compiles osrender against
the instance's FFmpeg. Missing hardware support or a failed render falls back
to FFmpeg. Use `GPU_RENDER=0` to return to the default renderer. CI compiles
the native code on Ubuntu 24.04; actual GPU output, audio sync and speed still
need the hardware equivalence tests before enabling it for customers.

Current encoding-quality defaults remain. `FFMPEG_NVENC_PRESET=p3` optionally
selects upstream's faster preset; larger files may offset its encoding benefit
during transfers. The usual CUDA 12.8 base template is still used.

The managed-billing source-range picker, billing changes, OAuth integration
and multi-user media authorization were not merged into this personal update.
The source-range picker changes the input workflow and needs a separate
self-host adaptation. This update is not a complete public SaaS or Serverless
deployment.
