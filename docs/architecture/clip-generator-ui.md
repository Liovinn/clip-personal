# Clipedit interface

The clipping workspace uses Bahasa Indonesia for navigation, settings, help,
editor labels and download controls. The HTML language is `id`. Internal API
values, storage keys, video prompts, generated content and raw server logs keep
their original behavior; translating the UI does not force the video language.
The copy uses clear, professional Indonesian and familiar product terms.
Clip count, duration, layout and auto-title settings are always visible on
the creation page; there is no advanced-options disclosure. Empty fields keep
the existing AI defaults. The output-format label is simply "Format".
The source tabs show Link video first (selected by default), then Upload file.
If the backend disables video URLs, the existing fallback selects file upload.

The intended deployment is a VPS/domain frontend and API with RunPod Serverless
GPU workers. This is a deployment direction, not an implemented worker or queue;
the existing Vast scripts are legacy utilities and do not define the UI flow.

Clipedit presents only the clip generator. The horizontal navigation contains
Clip generator and Settings, on both desktop and mobile. The start view uses a
centered creation panel with a plain heading. Settings shares the same content
width. The wordmark is text only; neutral charcoal surfaces and a lavender
accent replace the earlier navy marketing layout. Numbered section labels,
the header tagline and decorative onboarding steps are removed. A single
connection notice links to Settings when the Gemini key is missing.

Settings contains the Gemini API key for self-hosted installs, or the existing
managed-account status when billing is enabled. Social connections, ElevenLabs,
fal.ai and agent/MCP connectors are not mounted. There are no landing-page,
open-source or contact links in the app navigation.

Video URLs and uploads retain the same format, duration, layout and auto-hook
controls. Results retain preview, clipping edits, reframing, effects, subtitles,
hooks and downloads, including configured VPS exports. Posting, scheduling and
voice dubbing are not presented. Generation request defaults and the underlying
processing pipeline are unchanged.

Saved sessions and old tool deep links return to the generator when their
previous tab is unavailable. The frontend does not mount the marketing landing
page, OAuth agent consent or the additional tools. The SEO plugin and standalone
tool build entries are inactive. Existing managed account and billing utilities
remain, with clipping-only feature copy and no agent/social connections.

Optional backend modules and endpoints remain in the repository. This frontend
change does not alter their authorization rules or deploy Serverless workers.
