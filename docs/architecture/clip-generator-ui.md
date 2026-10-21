# Clip generator interface

This fork opens directly into the clip generator. Its desktop navigation,
mobile drawer and mobile shortcuts expose only Clip Generator and Settings.
Settings contains the Gemini key input for self-hosted installs, or an account
status message in managed mode. Existing account and billing routes remain for
managed deployments. Their pricing copy describes clipping only, and the account
screen no longer mounts social analytics, API-key management or MCP connections.
Successful checkouts return to the account screen without a social connection
redirect. Billing amounts, quotas and checkout logic are otherwise unchanged.

The generator still accepts video URLs and uploaded files and exposes the same
format, duration, layout and auto-hook controls. Generated clips retain previews,
clip editing, reframing, effects, subtitles, hooks, captions and downloads.
Job ZIP downloads and configured VPS exports remain available.

AI Shorts, AI Agent, UGC Gallery, YouTube Studio, Autopilot and History are no
longer mounted. Social account connections, posting, scheduling, voice dubbing
and their credential inputs are removed from this interface. Saved sessions and
old tab deep links fall back to the clip generator when their tab was removed.

The frontend build uses the app entry point only. The upstream marketing page
and standalone free tools are no longer emitted by the SEO plugin. Their source
files and the optional backend APIs remain in the repository; this is an
interface simplification, not removal or authorization of backend endpoints.

The video processing pipeline, model choices and generation request defaults
are unchanged. This change does not deploy a Serverless worker or add payments.
