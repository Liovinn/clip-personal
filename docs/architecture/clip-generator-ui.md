# Clipedit interface

Clipedit presents only the clip generator. The horizontal navigation contains
Clip generator and Settings, on both desktop and mobile. The desktop start view
uses a two-column introduction and video-input layout. Smaller screens stack
those sections. The wordmark is text only and the palette uses navy and blue.

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
