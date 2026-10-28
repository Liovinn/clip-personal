import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Check, ChevronDown, Activity, LayoutDashboard, Settings, Plus, X, Terminal, RotateCcw, AlertTriangle, KeyRound, Loader2 } from 'lucide-react';
import KeyInput from './components/KeyInput';
import MediaInput from './components/MediaInput';
import ResultCard from './components/ResultCard';
import JobDownloads from './components/JobDownloads';
import ProcessingAnimation from './components/ProcessingAnimation';
import ClipEditor from './components/ClipEditor';
import ReframeEditor from './components/ReframeEditor';
import UsageMeter from './components/UsageMeter';
import TopUpModal from './components/TopUpModal';
import WatermarkModal, { watermarkNoticeDismissed } from './components/WatermarkModal';
import { getApiUrl } from './config';
import PlanChoiceModal from './components/PlanChoiceModal';
import ClipTutorial from './components/ClipTutorial';
import OnboardingSurvey from './components/OnboardingSurvey';
import TrialUpgradeModal from './components/TrialUpgradeModal';
import LoginModal from './components/LoginModal';
import TrialGate from './components/TrialGate';
import ProfileMenu from './components/ProfileMenu';
import Modal from './components/ui/Modal';
import { useAuth } from './contexts/AuthContext';
import { apiFetch, apiJson, QuotaError, QUOTA_WALL_EVENT } from './lib/api';
import { track } from './lib/analytics';

/* The job a signed-out visitor started, parked until they come back signed in.
 *
 * Pressing "get free clips" without a session used to open the login modal and
 * drop the work on the floor: the magic link lands on a fresh document, so the
 * pasted URL was gone and the highest-intent step in the funnel ended in an
 * empty form. The same is true of the Google round trip.
 *
 * So the request is written down before the redirect and replayed after it.
 * localStorage rather than sessionStorage because the magic link usually opens
 * in a new tab, and a TTL because a request parked last week is not what the
 * user is doing now. File uploads cannot be serialised (a File is not JSON), so
 * those are only resumed within the same document, via the in-memory fallback. */
const PENDING_JOB_KEY = 'os_pending_job';
const PENDING_JOB_TTL_MS = 60 * 60 * 1000;
let pendingJobInMemory = null;

function stashPendingJob(data) {
  const stamp = Date.now();
  const entry = { stamp, data: { ...data, payload: typeof data?.payload === 'string' ? data.payload : null } };
  pendingJobInMemory = { stamp, data };
  try {
    localStorage.setItem(PENDING_JOB_KEY, JSON.stringify(entry));
  } catch (_) { /* private mode: the in-memory copy still covers same-document flows */ }
  return stamp;
}

function peekPendingJob() {
  try {
    const raw = localStorage.getItem(PENDING_JOB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.data?.payload && Date.now() - (parsed.stamp || 0) < PENDING_JOB_TTL_MS) {
        return parsed;
      }
      localStorage.removeItem(PENDING_JOB_KEY);
    }
  } catch (_) { /* ignore */ }
  // A File cannot survive a reload; this covers a sign-in that did not reload.
  if (pendingJobInMemory && Date.now() - pendingJobInMemory.stamp < PENDING_JOB_TTL_MS) {
    return pendingJobInMemory;
  }
  return null;
}

function clearPendingJob() {
  pendingJobInMemory = null;
  try {
    localStorage.removeItem(PENDING_JOB_KEY);
  } catch (_) { /* ignore */ }
}

const formatRetention = (seconds) => {
  if (seconds >= 86400) return `${Math.round(seconds / 86400)} day${seconds >= 172800 ? 's' : ''}`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} hour${seconds >= 7200 ? 's' : ''}`;
  return `${Math.max(1, Math.round(seconds / 60))} min`;
};

const SESSION_KEY = 'openshorts_session';

// The server's own explanation for a rejected/failed job, readable: FastAPI
// answers {"detail": "..."} or {"detail": {"message": ...}}. Showing the raw
// JSON (or a generic "failed") hid actionable reasons such as "this video is
// only 30s long", and new users in the tutorial saw only "That run failed".
const readableError = (raw) => {
  const text = String(raw || '').trim();
  try {
    const body = JSON.parse(text);
    const d = body?.detail ?? body;
    if (typeof d === 'string' && d) return d.slice(0, 300);
    if (d && typeof d.message === 'string') return d.message.slice(0, 300);
  } catch (_) { /* not JSON */ }
  return text.replace(/^Error:\s*/, '').slice(0, 300) || 'Something went wrong.';
};
// Matches the self-host JOB_RETENTION_SECONDS default. A restore whose job was
// already purged server-side fails gracefully and clears the saved session.
const SESSION_MAX_AGE = 86400000; // 24 hours

// Mock polling function
const pollJob = async (jobId) => {
  const res = await apiFetch(`/api/status/${jobId}`);
  if (!res.ok) throw new Error('Status check failed');
  return res.json();
};

function App() {
  // Cloud auth/billing session (inert when billing is disabled).
  const { billingEnabled, isManaged, isSignedIn, me, plan, refreshMe, jobRetentionSeconds, localLlm } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  // Free plan: "want the watermark off?" once per job, when the clips land.
  const [showWmNotice, setShowWmNotice] = useState(false);
  const wmNoticedJobRef = useRef(null);
  const [showPlanChoice, setShowPlanChoice] = useState(false);
  const [tutorialPhase, setTutorialPhase] = useState(null); // null | intro | coach | celebrate
  const [showTrialUpgrade, setShowTrialUpgrade] = useState(false);
  const [topUpInfo, setTopUpInfo] = useState({});
  // {processed_minutes, total_minutes} when the running/finished job clips
  // only the first part of the source (the quota wall's free offer).
  const [partialJob, setPartialJob] = useState(null);
  // The free plan's first video, clipped whole past the 20-minute balance.
  const [firstVideoJob, setFirstVideoJob] = useState(false);
  // {position, ahead, eta_seconds} while the job waits in line, else null.
  const [queueInfo, setQueueInfo] = useState(null);
  // Why the last job could not start or failed, in plain words (or '').
  const [jobError, setJobError] = useState('');
  // Durable R2 URLs (per clip index) for the current job — used as a fallback when
  // the ephemeral local /videos/ files have been cleaned up (e.g. after a reload).
  const [durableClips, setDurableClips] = useState({});

  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_key') || '');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, processing, complete, error
  const [results, setResults] = useState(null);
  // Best clips first. The backend hands them back in transcript order, which
  // buries the strongest one wherever it happens to fall in the video — and
  // the first card is the one people actually watch and publish.
  //
  // The ORIGINAL array position travels with each clip and is what gets passed
  // down as `index`: it is the clip's identity everywhere else (clip_index on
  // /api/subtitle, /api/edit and publishing, the clip-N.mp4 download name, the
  // saved per-clip project state). Sorting the array itself would silently
  // repoint all of that at the wrong clip.
  const rankedClips = useMemo(() => {
    const clips = results?.clips;
    if (!Array.isArray(clips)) return [];
    return clips
      .map((clip, index) => ({ clip, index }))
      .sort((a, b) => {
        const sa = Number.isFinite(a.clip?.predicted_score) ? a.clip.predicted_score : -1;
        const sb = Number.isFinite(b.clip?.predicted_score) ? b.clip.predicted_score : -1;
        // Ties (and clips with no score at all) keep transcript order.
        return sb - sa || a.index - b.index;
      });
  }, [results]);
  // Bulk subtitles: apply one style to every clip of the job (triggered from
  // within a clip's subtitle modal via "apply to all").
  const [bulkSub, setBulkSub] = useState({ running: false, current: 0, total: 0, errors: 0 });
  // Pre-flight quality gate: { info: {max_height, min_height, cookies_invalid}, data }
  const [qualityGate, setQualityGate] = useState(null);
  const [logs, setLogs] = useState([]);
  // When each server log line arrived (epoch s, parallel to logs), from /api/status.
  const [logTimes, setLogTimes] = useState([]);
  // Collapsed on phones: the log tail is the least useful thing on a 360px
  // screen and it was pushing the actual clips a full scroll down.
  const [logsVisible, setLogsVisible] = useState(() => {
    try { return window.innerWidth >= 768; } catch { return true; }
  });
  const [processingMedia, setProcessingMedia] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard, settings
  // Reopened-project state (paid mode): per-clip {index, server_file, active_layers}
  // restored from the backend so ResultCards resume editing where they left off.
  const [projectState, setProjectState] = useState(null);
  // True when the current job was reopened from the library: its source video
  // was never persisted, so the session must not fall back to /api/source.
  const [noSource, setNoSource] = useState(false);

  const [sessionRecovered, setSessionRecovered] = useState(false);
  // Clip editor overlay: index of the clip being edited, or null.
  const [editingClip, setEditingClip] = useState(null);
  const [reframingClip, setReframingClip] = useState(null);

  // Sync state for original video playback
  const [syncedTime, setSyncedTime] = useState(0);
  const [isSyncedPlaying, setIsSyncedPlaying] = useState(false);
  const [syncTrigger, setSyncTrigger] = useState(0);

  const handleClipPlay = (startTime) => {
    setSyncedTime(startTime);
    setIsSyncedPlaying(true);
    setSyncTrigger(prev => prev + 1);
  };

  const handleClipPause = () => {
    setIsSyncedPlaying(false);
  };

  // --- Project persistence (paid mode) ---
  // Debounced sync of each clip's browser-only edit state (Remotion layers +
  // current server file) to the backend, so a reopened project resumes intact.
  const clipStateSync = useRef({ jobId: null, pending: {}, files: {}, timer: null });
  // Read by in-flight async chases to notice that the user moved on to another job.
  const jobIdRef = useRef(jobId);
  useEffect(() => { jobIdRef.current = jobId; }, [jobId]);

  const flushClipState = () => {
    const s = clipStateSync.current;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    const entries = Object.entries(s.pending);
    if (!s.jobId || entries.length === 0) return;
    const clips = entries.map(([i, v]) => ({
      index: Number(i),
      active_layers: v.activeLayers,
      server_file: v.serverVideoFile,
    }));
    s.pending = {};
    apiFetch(`/api/projects/${s.jobId}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clips }),
    }).catch(() => {});
  };

  // One /api/history read, reduced to this job's clips.
  const fetchDurableMap = async () => {
    const d = await apiJson('/api/history');
    const map = {};
    for (const v of (d.videos || [])) {
      if (v.job_id === jobId && v.clip_index != null) map[v.clip_index] = { url: v.view_url, filename: v.filename };
    }
    return map;
  };

  // A server-side edit rewrites the clip's file while the R2 re-archive behind it
  // is still in flight (_archive_clip_edit_bg is fire-and-forget), so the durable
  // map goes stale and the card falls back to streaming from the API. Re-read the
  // map on a backoff until the archived name matches the clip's new file, then it
  // can play from R2 again. Gives up quietly: staying on /videos is correct, just
  // slower, and is exactly what happens for self-hosted users all the time.
  // opts.source / opts.highlight: which surface opened it (CheckoutStarted
  // source) and which plan the modal puts forward (WatermarkModal: starter).
  // opts.partialJob: the trimmed job on screen, so the modal sells the rest of it.
  const openUpsell = (opts = {}) => {
    setTopUpInfo({ context: 'upsell', source: opts.source, highlight: opts.highlight,
                   partialJob: opts.partialJob || null });
    setShowTopUp(true);
  };

  // Out-of-minutes errors from clip editing
  // (lib/api.openQuotaWall) open the same wall as the main clip flow.
  const meStatus = me?.status;
  useEffect(() => {
    if (!isManaged) return undefined;
    const onWall = (ev) => {
      refreshMe();
      if (meStatus === 'trialing') { setShowTrialUpgrade(true); return; }
      const d = ev.detail || {};
      setTopUpInfo({ context: 'wall', required: d.required, remaining: d.remaining, source: d.source });
      setShowTopUp(true);
    };
    window.addEventListener(QUOTA_WALL_EVENT, onWall);
    return () => window.removeEventListener(QUOTA_WALL_EVENT, onWall);
  }, [isManaged, meStatus, refreshMe]);

  // The clips just landed on a free account: ask once, per job, whether they
  // want the mark off. A beat after the grid renders, so the first thing they
  // see is their clips and not a modal over them.
  useEffect(() => {
    if (status !== 'complete' || plan !== 'free' || !isManaged || !jobId) return;
    if (!(results?.clips?.length > 0)) return;
    // Not on top of the tutorial's celebrate step: it shows once that closes.
    if (tutorialPhase === 'coach' || tutorialPhase === 'celebrate') return;
    if (wmNoticedJobRef.current === jobId || watermarkNoticeDismissed(jobId)) return;
    wmNoticedJobRef.current = jobId;
    const t = setTimeout(() => { if (jobIdRef.current === jobId) setShowWmNotice(true); }, 2500);
    return () => clearTimeout(t);
  }, [status, plan, isManaged, jobId, results?.clips?.length, tutorialPhase]);

  // Paying re-points the clips already on screen at their clean twins (the API
  // does it from the Stripe webhook, a few seconds after the plan flips). Chase
  // the job result until no served file carries the wm_ prefix, then refresh
  // the durable map so the players switch to the clean R2 copies too.
  useEffect(() => {
    if (!isManaged || !jobId || !plan || plan === 'free') return;
    const isMarked = (c) => /\/wm_[^/]*$/.test(c?.video_url || '');
    if (!(results?.clips || []).some(isMarked)) return;
    let cancelled = false;
    (async () => {
      for (const delay of [1500, 3000, 6000, 12000, 20000]) {
        await new Promise((r) => setTimeout(r, delay));
        if (cancelled || jobIdRef.current !== jobId) return;
        let data;
        try { data = await pollJob(jobId); } catch { continue; }
        if (cancelled || jobIdRef.current !== jobId) return;
        if (data?.result) setResults(data.result);
        if (!(data?.result?.clips || []).some(isMarked)) {
          fetchDurableMap().then((m) => { if (!cancelled) setDurableClips(m); }).catch(() => {});
          return;
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, isManaged, jobId]);

  const chaseDurableFile = async (index, expectedFile) => {
    const forJob = jobId;
    for (const delay of [2500, 6000, 15000, 30000]) {
      await new Promise((r) => setTimeout(r, delay));
      if (jobIdRef.current !== forJob) return;
      let map;
      try { map = await fetchDurableMap(); } catch { return; }
      // A new job started mid-chase: this map describes the old one, so dropping
      // it here keeps it from overwriting the new job's URLs.
      if (jobIdRef.current !== forJob) return;
      setDurableClips(map);
      if (map[index]?.filename === expectedFile) return;
    }
  };

  const handleClipStateChange = (index, state) => {
    if (!isManaged || !jobId) return;
    const s = clipStateSync.current;
    if (s.jobId !== jobId) { s.pending = {}; s.files = {}; s.jobId = jobId; }
    s.pending[index] = state;
    // Cards report on mount too, so only an actual change of server file means an
    // edit just landed. The first report per clip is the mount, never a chase.
    const files = s.files || (s.files = {});
    const file = state?.serverVideoFile;
    if (file && files[index] !== file) {
      const isMount = files[index] === undefined;
      files[index] = file;
      if (!isMount) chaseDurableFile(index, file);
    }
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(flushClipState, 2000);
  };

  // A recut replaced the clip's server file with a fresh render (burned layers
  // reset), so update the results, the reopened-project state and the synced
  // per-clip edit state, and let the ResultCard remount from the new file.
  const handleClipRerendered = (index, data) => {
    const newFile = (data.new_video_url || '').split('/').pop();
    setResults((prev) => {
      if (!prev?.clips?.[index]) return prev;
      const clips = prev.clips.slice();
      clips[index] = {
        ...clips[index],
        video_url: data.new_video_url,
        start: data.start,
        end: data.end,
        recipe: data.recipe,
      };
      return { ...prev, clips };
    });
    setProjectState((prev) => {
      if (!prev?.clips) return prev;
      return {
        ...prev,
        clips: prev.clips.map((c) => (c.index === index
          ? { ...c, server_file: newFile, active_layers: null }
          : c)),
      };
    });
    // The old durable R2 object is deleted when the recut is archived, so the
    // stale URL would 404 as a fallback; drop it until the next refresh.
    setDurableClips((prev) => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
    handleClipStateChange(index, { activeLayers: null, serverVideoFile: newFile });
  };

  // Apply one subtitle style to every clip of the job, sequentially.
  const handleBulkSubtitles = async (options) => {
    const clips = results?.clips || [];
    const total = clips.length;
    if (!total) return;
    setBulkSub({ running: true, current: 0, total, errors: 0 });
    let errors = 0;
    for (let i = 0; i < total; i++) {
      setBulkSub({ running: true, current: i + 1, total, errors });
      try {
        const res = await apiFetch('/api/subtitle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: jobId,
            clip_index: i,
            position: options.position,
            font_size: options.fontSize,
            font_name: options.fontName,
            font_color: options.fontColor,
            border_color: options.borderColor,
            border_width: options.borderWidth,
            bg_color: options.bgColor,
            bg_opacity: options.bgOpacity,
            style: options.style || 'pill',
            highlight_color: options.highlightColor || '#FFD700',
            effect: options.effect || 'none',
            base_opacity: options.baseOpacity ?? 1.0,
            uppercase: options.uppercase || false,
            reveal: options.reveal || false,
            shadow: options.shadow || 0,
            max_chars: options.maxChars ?? null,
            max_duration: options.maxDuration ?? null,
            // Chain from the clip's current server file (its video_url basename).
            input_filename: (clips[i].video_url || '').split('/').pop(),
          }),
        });
        if (!res.ok) errors++;
      } catch {
        errors++;
      }
    }
    setBulkSub({ running: false, current: total, total, errors });
    refreshMe();
    // Refresh results so each ResultCard picks up its new subtitled video_url.
    try {
      const data = await pollJob(jobId);
      if (data.result) setResults(data.result);
    } catch { /* keep current results */ }
  };

  // Session Recovery: Restore on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (!saved) return;
      const session = JSON.parse(saved);
      if (Date.now() - session.timestamp > SESSION_MAX_AGE) {
        localStorage.removeItem(SESSION_KEY);
        return;
      }
      if (session.jobId && session.status && session.status !== 'idle') {
        setJobId(session.jobId);
        setResults(session.results || null);
        // Restore the source preview. Older sessions (or uploads) saved no
        // media, so fall back to the backend-served source for this job —
        // except for reopened projects, whose source was never persisted.
        if (session.processingMedia) setProcessingMedia(session.processingMedia);
        else if (!session.noSource) setProcessingMedia({ type: 'server', payload: `/api/source/${session.jobId}` });
        if (session.noSource) setNoSource(true);
        if (session.projectState) setProjectState(session.projectState);
        if (session.activeTab) setActiveTab(session.activeTab === 'settings' ? 'settings' : 'dashboard');
        // If was processing, resume polling; if complete/error, just show results
        setStatus(session.status === 'processing' ? 'processing' : session.status);
        setSessionRecovered(true);
        setTimeout(() => setSessionRecovered(false), 5000);
      }
    } catch (e) {
      localStorage.removeItem(SESSION_KEY);
    }
  }, []);

  // Session Recovery: Save state changes
  useEffect(() => {
    if (status === 'idle') {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    try {
      // URL (YouTube) media serializes as-is. Uploaded 'file' media is a blob
      // that can't be persisted, so point the recovered preview at the source
      // served by the backend instead of dropping it.
      let persistMedia = null;
      if (processingMedia?.type === 'url') persistMedia = processingMedia;
      else if (processingMedia && jobId) persistMedia = { type: 'server', payload: `/api/source/${jobId}` };
      const sessionData = {
        jobId,
        status,
        results,
        processingMedia: persistMedia,
        activeTab,
        noSource,
        projectState,
        timestamp: Date.now()
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    } catch (e) {
      // localStorage full or serialization error - ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, status, results, activeTab, noSource, projectState]);

  useEffect(() => {
    if (apiKey) localStorage.setItem('gemini_key', apiKey);
  }, [apiKey]);

  // For managed users, fetch the durable R2 URLs of the current job's clips. The
  // preview player prefers them (free egress, edge-served, and not competing with
  // the renders for the API process), and falls back to /videos when the local
  // file is newer than the archived one or the signed link fails.
  // Kept fresh by chaseDurableFile after each edit and by the completion chase
  // below; until either lands, the card just streams from /videos.
  useEffect(() => {
    if (!isManaged || !jobId || !(results?.clips?.length)) { setDurableClips({}); return; }
    let cancelled = false;
    fetchDurableMap()
      .then((map) => { if (!cancelled) setDurableClips(map); })
      .catch(() => {});
    return () => { cancelled = true; };
    // Keyed on the clip COUNT, not on results: the status poll hands back a new
    // results object every couple of seconds while the job runs, and this used to
    // re-read the history on every one of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManaged, jobId, results?.clips?.length]);

  // A job is marked complete BEFORE _archive_managed_job has finished uploading
  // (app.py:878), so the read above can land while R2 still has nothing for it and
  // every card would stream from the API for the rest of the session. Chase until
  // all clips have a durable copy.
  useEffect(() => {
    const count = results?.clips?.length || 0;
    if (!isManaged || !jobId || status !== 'complete' || !count) return;
    let cancelled = false;
    (async () => {
      for (const delay of [0, 3000, 8000, 20000, 40000]) {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (cancelled) return;
        let map;
        try { map = await fetchDurableMap(); } catch { return; }
        if (cancelled) return;
        setDurableClips(map);
        if (Object.keys(map).length >= count) return;
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManaged, jobId, status, results?.clips?.length]);

  useEffect(() => {
    let interval;
    if ((status === 'processing' || status === 'completed') && jobId) {
      interval = setInterval(async () => {
        try {
          const data = await pollJob(jobId);
          console.log("Job status:", data);

          // Update results if available (real-time)
          if (data.result) {
            setResults(data.result);
          }

          if (data.partial) setPartialJob(data.partial);
          setQueueInfo(data.status === 'queued' && data.queue ? data.queue : null);

          if (data.status === 'completed') {
            setQueueInfo(null);
            setStatus('complete');
            clearInterval(interval);
            refreshMe();
          } else if (data.status === 'failed') {
            setStatus('error');
            const errorMsg = data.error || (data.logs && data.logs.length > 0 ? data.logs[data.logs.length - 1] : "Process failed");
            setJobError(readableError(errorMsg));
            setLogs(prev => [...prev, "Error: " + errorMsg]);
            clearInterval(interval);
            refreshMe();
          } else {
            // Update logs if available
            if (data.logs) {
              setLogs(data.logs);
              setLogTimes(data.log_times || []);
            }
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [status, jobId, refreshMe]);


  // Hosted is paid-only (no BYOK core). Self-host requires a moment picker.
  // A self-hosted server running the moment picker on a local LLM
  // (LLM_BASE_URL) does not need a Gemini key for the core pipeline.
  const geminiOk = !!apiKey || !!localLlm;
  const keysMissing = !billingEnabled && !geminiOk;
  const needsPlan = billingEnabled && !isManaged;   // hosted, signed-out or no active plan/trial

  // Fresh sign-up: Clip Generator tutorial (AuthContext set os_show_clip_tutorial
  // after the auth redirect). QA: #app?tutorial=1. Resume coach if they refreshed
  // mid-job. Runs once on mount so a later isSignedIn flip cannot reset intro→coach.
  useEffect(() => {
    let showTutorial = false;
    let resumeCoach = false;
    try {
      const q = new URLSearchParams((window.location.hash.split('?')[1] || ''));
      const qa = q.get('tutorial');
      if (qa === '1') showTutorial = true;
      if (qa === 'coach') resumeCoach = true;
      if (qa === 'celebrate') { setTutorialPhase('celebrate'); return; }
      if (localStorage.getItem('os_show_clip_tutorial') === '1') showTutorial = true;
      if (localStorage.getItem('os_clip_tutorial') === 'coach') resumeCoach = true;
      // A request parked before the sign-in redirect is about to resume on its
      // own: opening the intro ("paste a link and generate") on top of a job
      // that is already starting contradicts itself. Skip it for this signup.
      if (showTutorial && peekPendingJob()) {
        showTutorial = false;
        localStorage.removeItem('os_show_clip_tutorial');
      }
    } catch (_) { /* ignore */ }
    if (showTutorial) {
      setTutorialPhase('intro');
      setActiveTab('dashboard');
    } else if (resumeCoach) {
      setTutorialPhase('coach');
      setActiveTab('dashboard');
    }
  }, []);

  // Legacy: an older build may still have set os_show_plan_choice. Don't open it
  // on top of the tutorial.
  useEffect(() => {
    if (tutorialPhase) return;
    if (!(billingEnabled && isSignedIn)) return;
    let showPlans = false;
    try { showPlans = localStorage.getItem('os_show_plan_choice') === '1'; } catch (_) { /* ignore */ }
    if (showPlans) {
      setShowPlanChoice(true);
      try { localStorage.removeItem('os_show_plan_choice'); } catch (_) { /* ignore */ }
    }
  }, [billingEnabled, isSignedIn, tutorialPhase]);

  const tutorialLock = tutorialPhase === 'intro' || tutorialPhase === 'coach' || tutorialPhase === 'celebrate';

  // Sign-up survey (cloud/onboarding.py): before the tutorial intro, never on
  // top of a job that is already running (a parked request resuming, or the
  // coach phase) or of the celebration.
  const [surveyDone, setSurveyDone] = useState(false);
  const showSurvey = billingEnabled && !!me?.onboarding_survey_pending && !surveyDone
    && (tutorialPhase === null || tutorialPhase === 'intro') && status === 'idle';

  useEffect(() => {
    if (tutorialLock && activeTab !== 'dashboard') setActiveTab('dashboard');
  }, [tutorialLock, activeTab]);

  // Only clip generation and settings can be opened by a saved deep link.
  // Read once per hash change, then the query is
  // dropped so a reload does not keep forcing the tab.
  useEffect(() => {
    const DEEP_LINK_TABS = ['settings', 'dashboard'];
    const apply = () => {
      const hash = window.location.hash || '';
      if (!hash.startsWith('#app?')) return;
      const params = new URLSearchParams(hash.slice(5));
      const tab = params.get('tab');
      if (!tab) return;  // e.g. #app?tutorial=1
      setActiveTab(DEEP_LINK_TABS.includes(tab) ? tab : 'dashboard');
      try { window.history.replaceState(null, '', '#app'); } catch (_) { /* ignore */ }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  useEffect(() => {
    if (tutorialPhase === 'coach' && status === 'complete' && (results?.clips?.length > 0)) {
      setTutorialPhase('celebrate');
      track('ClipTutorialCompleted', { props: { clips: results.clips.length } });
    }
  }, [tutorialPhase, status, results]);

  const finishTutorial = () => {
    try { localStorage.setItem('os_clip_tutorial', 'done'); } catch (_) { /* ignore */ }
    try { localStorage.removeItem('os_show_clip_tutorial'); } catch (_) { /* ignore */ }
    setTutorialPhase(null);
  };
  const startTutorial = () => {
    try { localStorage.setItem('os_clip_tutorial', 'coach'); } catch (_) { /* ignore */ }
    try { localStorage.removeItem('os_show_clip_tutorial'); } catch (_) { /* ignore */ }
    track('ClipTutorialStarted');
    setTutorialPhase('coach');
    setActiveTab('dashboard');
  };
  const skipTutorial = () => {
    track('ClipTutorialSkipped', { props: { phase: tutorialPhase } });
    finishTutorial();
  };
  const gateThisTab = needsPlan && activeTab === 'dashboard';

  const handleProcess = async (data, forceLowQuality = false) => {
    // Hosted: must be signed in AND on an active plan/trial. Self-host: BYOK keys.
    if (billingEnabled) {
      // The billing gate below is unchanged: signed in, then entitled, then the
      // processing path. The only new thing is the first branch remembering what
      // the visitor asked for before sending them to sign in, so the resume
      // effect can hand the exact same request back to this function and let it
      // fall through the same gates.
      if (!isSignedIn) { stashPendingJob(data); setShowLogin(true); return; }
      if (!isManaged) { window.location.hash = '#/pricing'; return; }
    } else if (keysMissing) {
      setShowKeyModal(true);
      return;
    }
    // Past every gate, so this request is really running: nothing left to resume.
    clearPendingJob();
    setStatus('processing');
    setJobError('');
    setLogs(["Starting process..."]);
    setLogTimes([Date.now() / 1000]);
    setResults(null);
    // Studio handovers have no local media object; the preview switches to the
    // backend-served source once the job id is known.
    setProcessingMedia(data.type === 'thumbnail_session' ? null : data);
    setQualityGate(null);
    setProjectState(null);
    setNoSource(false);
    setPartialJob(null);
    setFirstVideoJob(false);

    try {
      let body;
      // BYOK sends the Gemini header; managed users rely on the bearer token
      // that apiFetch attaches automatically.
      const headers = apiKey ? { 'X-Gemini-Key': apiKey } : {};

      // Advanced generation controls: only sent when the user set them, so the
      // default request stays byte-identical to the pre-feature one.
      const advanced = {
        target_clips: data.targetClips || null,
        clip_min_seconds: data.clipMinSeconds || null,
        clip_max_seconds: data.clipMaxSeconds || null,
        // Sent explicitly both ways: absent means off for raw API callers,
        // but the dashboard always states the user's choice.
        auto_hook: data.autoHook ? '1' : '0',
        auto_hook_style: data.autoHook ? (data.autoHookStyle || 'pill') : null,
        // 'auto' is the server default, so only a deliberate choice travels.
        layouts: data.layout && data.layout !== 'auto' ? data.layout : null,
        // Set when the user took the quota wall's "clip the first N minutes"
        // offer: the server reserves N minutes and cuts the source to them.
        max_minutes: data.maxMinutes || null,
      };

      if (data.type === 'url') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify({
          url: data.payload,
          output_format: data.outputFormat || 'auto',
          force_low_quality: forceLowQuality,
          ...Object.fromEntries(Object.entries(advanced).filter(([, v]) => v != null)),
        });
      } else if (data.type === 'thumbnail_session') {
        // Handover from Thumbnail Studio (issue #68): the video and transcript
        // already live server-side, keyed by the Studio session.
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify({
          thumbnail_session_id: data.payload,
          output_format: data.outputFormat || 'auto',
          ...Object.fromEntries(Object.entries(advanced).filter(([, v]) => v != null)),
        });
      } else {
        const formData = new FormData();
        formData.append('file', data.payload);
        formData.append('output_format', data.outputFormat || 'auto');
        for (const [k, v] of Object.entries(advanced)) {
          if (v != null) formData.append(k, v);
        }
        body = formData;
      }

      const res = await apiFetch('/api/process', { method: 'POST', headers, body });

      if (!res.ok) throw new Error(await res.text());
      const resData = await res.json();

      // Quality gate: the source is below the min resolution — ask before burning
      // 20 min on it. On confirm we resend with force_low_quality.
      if (resData.needs_confirmation) {
        setStatus('idle');
        setQualityGate({ info: resData.quality_check, data });
        return;
      }

      setJobId(resData.job_id);
      setPartialJob(resData.partial || null);
      setFirstVideoJob(!!resData.first_video);
      // The server clipped past the balance on its own (no wall): the first
      // video whole, or the first N minutes of a later one.
      if (resData.first_video) track('FirstVideoGrant');
      else if (resData.partial && data.maxMinutes == null) {
        track('AutoPartial', { props: { processed: resData.partial.processed_minutes, total: resData.partial.total_minutes } });
      }
      if (data.type === 'thumbnail_session') {
        setProcessingMedia({ type: 'server', payload: `/api/source/${resData.job_id}` });
      }
      // Minutes are reserved at job start, not at complete.
      refreshMe();

    } catch (e) {
      if (e instanceof QuotaError) {
        setStatus('idle');
        refreshMe();
        // Trial users hit the trial minute cap → prompt them to activate the plan
        // now (unlocks full minutes). Active users → offer a top-up.
        if (me?.status === 'trialing') {
          setShowTrialUpgrade(true);
        } else {
          // The wall can offer the first N minutes of this same submission on
          // the minutes they have: same data, plus max_minutes.
          const partial = e.partialMinutes || 0;
          setTopUpInfo({
            required: e.minutesRequired,
            remaining: e.minutesRemaining,
            partialMinutes: partial,
            onPartial: partial
              ? () => {
                  track('PartialClipChosen', { props: { required: e.minutesRequired, partial } });
                  setShowTopUp(false);
                  handleProcess({ ...data, maxMinutes: partial }, forceLowQuality);
                }
              : null,
          });
          setShowTopUp(true);
        }
        return;
      }
      const reason = readableError(e.message);
      setJobError(reason);
      setStatus('error');
      setLogs(l => [...l, `Error starting job: ${reason}`]);
    }
  };

  // Resume the job the visitor started before signing in. Runs on the render
  // that first sees isSignedIn true — after a magic link or a Google round trip,
  // i.e. a fresh document — and replays the request through handleProcess, so
  // the entitlement gate still decides whether it actually runs: an unentitled
  // account lands on #/pricing with the request still parked, and pays for it
  // later. `resumedStamp` keeps one parked request from being replayed twice in
  // the same document (the pricing redirect would otherwise loop on it).
  const handleProcessRef = useRef(null);
  const resumedStampRef = useRef(0);
  useEffect(() => {
    handleProcessRef.current = handleProcess;
  });
  useEffect(() => {
    if (!billingEnabled || !isSignedIn) return;
    const pending = peekPendingJob();
    if (!pending || pending.stamp === resumedStampRef.current) return;
    resumedStampRef.current = pending.stamp;
    track('JobResumedAfterSignin', { props: { type: pending.data?.type || 'unknown' } });
    handleProcessRef.current(pending.data);
  }, [billingEnabled, isSignedIn]);

  const handleReset = () => {
    // Flush any pending edit-state sync before dropping the project: the clips
    // themselves are already archived to R2 as they were edited.
    flushClipState();
    setStatus('idle');
    setJobId(null);
    setResults(null);
    setLogs([]);
    setLogTimes([]);
    setProcessingMedia(null);
    setProjectState(null);
    setNoSource(false);
    setPartialJob(null);
    setFirstVideoJob(false);
    setQueueInfo(null);
    setJobError('');
    localStorage.removeItem(SESSION_KEY);
  };

  // --- UI Components ---

  const navItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Clip generator' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];
  const goToTab = (id) => {
    if (tutorialLock && id !== 'dashboard') return;
    setActiveTab(id);
  };
  const tabLocked = (id) => tutorialLock && id !== 'dashboard';
  const HeaderNavigation = () => (
    <nav className="ce-top-nav" aria-label="Workspace">
      {navItems.map((item) => {
        const NavIcon = item.icon;
        return (
          <button
            key={item.id}
            data-tutorial={item.id === 'dashboard' ? 'nav-clips' : undefined}
            onClick={() => goToTab(item.id)}
            disabled={tabLocked(item.id)}
            aria-current={activeTab === item.id ? 'page' : undefined}
            className={activeTab === item.id ? 'is-active' : ''}
          >
            <NavIcon size={16} /> {item.label}
          </button>
        );
      })}
    </nav>
  );

  return (
    /* h-dvh where supported: on mobile Safari/Chrome `100vh` is the tallest the
       viewport ever gets, so a h-screen shell hides its own bottom bar behind
       the browser chrome until the user scrolls. */
    <div className="clipedit-app flex h-screen supports-[height:100dvh]:h-[100dvh] bg-paper overflow-hidden">

      <main className="flex-1 min-w-0 flex flex-col h-full overflow-hidden relative">
        {/* Top Header */}
        <header className="clipedit-topbar ce-header border-b border-rule shrink-0 z-10">
          <div className="ce-header-brand">
            <a href="#app" onClick={() => goToTab('dashboard')} className="clipedit-wordmark">Clipedit</a>
            {status !== 'idle' && (
              <button
                onClick={handleReset}
                className="btn-quiet px-3 py-1.5 text-xs shrink-0"
                aria-label="New Project"
              >
                <Plus size={14} />
                <span className="hidden sm:inline">New Project</span>
              </button>
            )}
          </div>

          <HeaderNavigation />

          <div className="ce-header-actions flex items-center gap-2 sm:gap-4 shrink-0">
            {/* Cloud: minutes meter + account/sign-in. For free users the meter
                opens the upgrade modal — otherwise the only path to a plan is
                failing against the quota wall. */}
            {billingEnabled && isManaged && (
              <UsageMeter onClick={() => {
                if (plan === 'free') openUpsell({ source: 'meter' });
                else { window.location.hash = '#/account'; }
              }} />
            )}
            {billingEnabled && isSignedIn && !isManaged && (
              <button onClick={() => setShowPlanChoice(true)}
                className="btn-primary px-4 py-2 text-xs">
                Choose a plan
              </button>
            )}
            {billingEnabled && !isSignedIn && (
              <button onClick={() => setShowLogin(true)}
                className="btn-ghost px-4 py-2 text-xs">
                Sign in
              </button>
            )}
            {billingEnabled && isSignedIn && <ProfileMenu onUpgrade={isManaged ? openUpsell : null} />}
          </div>
        </header>

        {/* Persistent Missing Keys Banner — visible on every screen */}
        {keysMissing && activeTab !== 'settings' && (
          <div className="ce-connection-notice shrink-0 animate-fade">
            <div className="flex items-center gap-2.5 min-w-0">
              <KeyRound size={15} className="shrink-0" />
              <p>Connect Gemini to start creating clips.</p>
            </div>
            <button
              onClick={() => goToTab('settings')}
              className="ce-notice-action shrink-0"
            >
              Add API key <ChevronDown size={13} className="-rotate-90" />
            </button>
          </div>
        )}

        {/* Session Recovery Banner */}
        {sessionRecovered && (
          <div className="mx-3 sm:mx-6 mt-2 px-3.5 sm:px-4 py-3 bg-paper2 border border-rule rounded-card flex items-start justify-between gap-3 animate-fade shrink-0">
            <div className="flex items-start sm:items-center gap-2 text-sm text-ink2 flex-wrap min-w-0">
              <RotateCcw size={16} className="text-brass shrink-0 mt-0.5 sm:mt-0" />
              <span className="font-medium">Session recovered</span>
              <span className="text-muted text-xs">Your previous work has been restored.</span>
            </div>
            <button
              onClick={() => setSessionRecovered(false)}
              aria-label="dismiss"
              className="text-muted hover:text-ink transition-colors shrink-0 -m-1 p-1"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Non-blocking trial prompt for clip generation. */}
        {gateThisTab && <TrialGate toolName="the Clip Generator" />}

        {/* Main Workspace */}
        <div className="flex-1 overflow-hidden relative">

          {/* Clip generator settings */}
          {activeTab === 'settings' && (
            <div className="ce-settings h-full overflow-y-auto custom-scrollbar animate-fade">
              <div className="ce-page-heading">
                <h1>Settings</h1>
                <p>Manage your connection for clip generation.</p>
              </div>
              {billingEnabled ? (
                <div className="card p-6">
                  <h2 className="text-base font-medium text-ink lowercase">Clip generation</h2>
                  <p className="text-sm text-muted mt-3">
                    {isManaged ? 'Your account includes clip generation. No API key is required.' : 'Sign in and choose a plan to generate clips.'}
                  </p>
                </div>
              ) : (
                <KeyInput onKeySet={setApiKey} savedKey={apiKey} />
              )}
            </div>
          )}

          {/* Clip generator workspace */}
          {activeTab === 'dashboard' && status === 'idle' && (
            <div className="clipedit-start h-full overflow-y-auto custom-scrollbar animate-fade">
              <div className="ce-start-layout">
                <section className="ce-page-heading">
                  <h1>Create clips</h1>
                  <p>Find the best moments in your video. Make them ready to share.</p>
                </section>
                <MediaInput onProcess={handleProcess} isProcessing={status === 'processing'} />
              </div>
            </div>
          )}

          {/* View: Processing / Results (Split View) */}
          {activeTab === 'dashboard' && (status === 'processing' || status === 'complete' || status === 'error') && (
            <div className="h-full flex flex-col md:flex-row gap-3 md:gap-4 p-3 md:p-4 overflow-y-auto md:overflow-y-hidden custom-scrollbar animate-fade">

              {/* Left Panel: Preview & Status */}
              <div className={`${status === 'complete' ? 'w-full md:w-[30%] lg:w-[25%]' : 'w-full md:w-[55%] lg:w-[60%]'} md:h-full flex flex-col shrink-0 md:shrink card p-3.5 sm:p-6 md:overflow-y-auto custom-scrollbar transition-all duration-700 ease-in-out`}>
                <div className="mb-4 sm:mb-6 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-medium text-ink lowercase flex items-center gap-2">
                    <Activity className={`text-brass ${status === 'processing' ? 'animate-pulse' : ''}`} size={18} />
                    Live Analysis
                  </h2>
                  <span className={status === 'processing' ? 'badge-brass' :
                    status === 'complete' ? 'badge-ok' :
                      'badge-danger'
                    }>
                    {status.toUpperCase()}
                  </span>
                </div>

                {/* Trimmed run: say it while it renders, not only once the
                    clips land, so the shorter result is no surprise. */}
                {status === 'processing' && partialJob && plan === 'free' && isManaged && (
                  <button
                    onClick={() => openUpsell({ source: 'partial_processing', partialJob })}
                    className="mb-4 w-full text-left rounded-card border border-brass/40 bg-brass/5 px-4 py-3 text-sm hover:border-brass transition-colors"
                  >
                    <span className="text-ink">Clipping the first {partialJob.processed_minutes} of {partialJob.total_minutes} minutes with your free minutes.</span>{' '}
                    <span className="text-brass font-medium">Clip the whole video →</span>
                  </button>
                )}

                {/* Waiting in line: say where and for how long, and that paid
                    plans go first (they do: plan priority in the job queue). */}
                {status === 'processing' && queueInfo && (
                  <div className="mb-4 rounded-card border border-brass/40 bg-brass/5 px-4 py-3 text-sm">
                    <p className="text-ink">
                      {queueInfo.ahead === 0
                        ? 'You are next in line. Starting in a moment…'
                        : <>You are <b>#{queueInfo.position}</b> in line · about <b>{Math.max(1, Math.round(queueInfo.eta_seconds / 60))} min</b></>}
                    </p>
                    {billingEnabled && !['starter', 'creator', 'pro'].includes(plan) && queueInfo.ahead > 0 && (
                      <button
                        onClick={() => { track('QueueUpsellClick', { props: { position: String(queueInfo.position) } }); if (isManaged) openUpsell({ source: 'queue' }); else setShowPlanChoice(true); }}
                        className="mt-2 text-xs lowercase text-brass hover:underline"
                      >
                        paid plans skip the line →
                      </button>
                    )}
                  </div>
                )}

                {/* Video Preview */}
                {processingMedia && (
                  <ProcessingAnimation
                    media={processingMedia}
                    isComplete={status === 'complete'}
                    syncedTime={syncedTime}
                    isSyncedPlaying={isSyncedPlaying}
                    syncTrigger={syncTrigger}
                  />
                )}

                {/* Phones only. The scan box drops its invented telemetry at
                    this size and the log terminal below starts collapsed, so
                    without this the screen would say nothing about what the job
                    is actually doing. The log tail is the real answer. */}
                {status === 'processing' && (
                  <div className="sm:hidden mb-3 flex items-start gap-2 text-xs text-ink2 min-w-0">
                    <Loader2 size={14} className="animate-spin text-brass shrink-0 mt-px" />
                    <span className="min-w-0 leading-snug break-words">
                      {logs.length ? logs[logs.length - 1] : 'starting up…'}
                    </span>
                  </div>
                )}

                {/* Logs Terminal */}
                <div className={`bg-paper rounded-card border border-rule overflow-hidden flex flex-col transition-all duration-500 ${status === 'complete' ? `min-h-0 opacity-50 hover:opacity-100 ${logsVisible ? 'h-32' : 'h-auto'}` : `flex-1 ${logsVisible ? 'min-h-[160px] sm:min-h-[200px]' : 'min-h-0 flex-none'}`}`}>
                  <button
                    type="button"
                    onClick={() => setLogsVisible(!logsVisible)}
                    aria-expanded={logsVisible}
                    className="w-full px-3.5 sm:px-4 py-2.5 border-b border-rule flex items-center justify-between gap-2 bg-paper2 shrink-0 text-left"
                  >
                    <span className="readout flex items-center gap-2">
                      <Terminal size={12} /> System Logs
                    </span>
                    <span className="flex items-center gap-2 text-muted">
                      {!logsVisible && logs.length > 0 && (
                        <span className="readout normal-case">{logs.length}</span>
                      )}
                      <ChevronDown size={16} className={logsVisible ? '' : 'rotate-180'} />
                    </span>
                  </button>
                  {logsVisible && (
                    <div className="flex-1 p-3.5 sm:p-4 overflow-y-auto font-mono text-[11px] sm:text-xs space-y-1.5 custom-scrollbar text-muted break-words">
                      {logs.map((log, i) => (
                        <div key={i} className={`flex gap-2 ${log.toLowerCase().includes('error') ? 'text-danger' : 'text-muted'}`}>
                          <span className="text-muted opacity-50 shrink-0 hidden sm:inline tabular-nums">
                            {logTimes[i] ? new Date(logTimes[i] * 1000).toLocaleTimeString() : ''}
                          </span>
                          <span className="min-w-0 break-words">{log}</span>
                        </div>
                      ))}
                      {status === 'processing' && (
                        <div className="animate-pulse text-brass">_</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Panel: Results Grid */}
              <div className={`${status === 'complete' ? 'w-full md:w-[70%] lg:w-[75%]' : 'w-full md:w-[45%] lg:w-[40%]'} md:h-full flex flex-col shrink-0 md:shrink card p-3.5 sm:p-6 transition-all duration-700 ease-in-out`}>
                {/* Keep clip counters and download controls on separate rows. */}
                <div className="mb-4 sm:mb-6 shrink-0 space-y-3">
                  <h2 className="font-display lowercase text-lg sm:text-xl text-ink flex flex-wrap items-center gap-2">
                    <span className="mr-auto">Generated Shorts</span>
                    {results?.clips?.length > 0 && (
                      <span className="readout bg-paper3 px-2.5 py-1 rounded-full">
                        {results.clips.length} Clips
                      </span>
                    )}
                    {results?.cost_analysis && !isManaged && (
                      <span className="readout bg-paper3 px-2.5 py-1 rounded-full" title={`Input: ${results.cost_analysis.input_tokens} | Output: ${results.cost_analysis.output_tokens}`}>
                        GEMINI · ${results.cost_analysis.total_cost.toFixed(5)}
                      </span>
                    )}
                  </h2>
                  {results?.clips?.length > 0 && status === 'complete' && (
                    <div className="flex flex-col sm:flex-row sm:justify-end items-stretch sm:items-center gap-2">
                      <JobDownloads key={jobId} jobId={jobId} allowDrive={!billingEnabled} />
                    </div>
                  )}
                </div>

                {status === 'complete' && results?.clips?.length > 0 && (
                  <div className="mb-2 space-y-2">
                    {/* Partial job: the clips on screen come from the first N
                        minutes only. Say so, and sell the rest of the video. */}
                    {partialJob && (
                      <button
                        onClick={() => openUpsell({ source: 'partial_banner', partialJob })}
                        className="w-full text-left px-3 py-2.5 rounded-input bg-paper3 border border-brass/40 hover:border-brass text-sm transition-colors"
                      >
                        <span className="text-ink">These clips come from the first {partialJob.processed_minutes} of {partialJob.total_minutes} minutes.</span>{' '}
                        <span className="text-brass font-medium">Clip the whole video →</span>
                      </button>
                    )}
                    {/* Peak-moment upsell: they just SAW their clips — sell while
                        they're proud of the result, before asking for stars. */}
                    {firstVideoJob && !partialJob && (
                      <button
                        onClick={() => openUpsell({ source: 'first_video_banner' })}
                        className="w-full text-left px-3 py-2.5 rounded-input bg-paper3 border border-brass/40 hover:border-brass text-sm transition-colors"
                      >
                        <span className="text-ink">Your first video is on us: we clipped all of it.</span>{' '}
                        <span className="text-muted">That used this month's free minutes.</span>{' '}
                        <span className="text-brass font-medium">Keep clipping →</span>
                      </button>
                    )}
                    {plan === 'free' && !partialJob && !firstVideoJob && (
                      <button
                        onClick={() => openUpsell({ source: 'results_banner' })}
                        className="w-full text-left px-3 py-2.5 rounded-input bg-paper3 border border-brass/40 hover:border-brass text-sm transition-colors"
                      >
                        <span className="text-ink">Like these clips?</span>{' '}
                        <span className="text-muted">Upgrade and these exact clips lose the watermark on the spot, and stay for good.</span>{' '}
                        <span className="text-brass font-medium">Remove the watermark →</span>
                      </button>
                    )}
                    {/* Self-host only: cloud archives clips to the video library,
                        here they really are gone once the retention sweep runs. */}
                    {!billingEnabled && jobRetentionSeconds > 0 && (
                      <div className="px-3 py-2.5 rounded-input bg-paper3 border border-paper3 text-sm">
                        <span className="text-ink">Clips are kept for {formatRetention(jobRetentionSeconds)}, then deleted.</span>{' '}
                        <span className="text-muted">Download what you want to keep, or raise JOB_RETENTION_SECONDS in your env.</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
                  {results && results.clips && results.clips.length > 0 ? (
                    <div className={`grid gap-4 pb-10 ${status === 'complete' ? 'grid-cols-[repeat(auto-fill,minmax(min(100%,600px),1fr))]' : 'grid-cols-1'}`}>
                      {rankedClips.map(({ clip, index: i }) => (
                        <ResultCard
                          key={`${jobId}-${i}-${clip.video_url || ''}`}
                          clip={clip}
                          index={i}
                          jobId={jobId}
                          onEditClip={(index) => setEditingClip(index)}
                          onReframeClip={(index) => setReframingClip(index)}
                          onUpgrade={isManaged ? openUpsell : null}
                          initialState={projectState?.clips?.find((c) => c.index === i) || null}
                          onStateChange={handleClipStateChange}
                          durable={durableClips[i]}
                          geminiApiKey={apiKey}
                          isManaged={isManaged}
                          onPlay={(time) => handleClipPlay(time)}
                          onPause={handleClipPause}
                          onBulkSubtitle={handleBulkSubtitles}
                          clipCount={results.clips.length}
                          bulkProgress={bulkSub}
                        />
                      ))}
                    </div>
                  ) : (
                    status === 'processing' ? (
                      <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-muted space-y-3 text-center px-4">
                        <Loader2 size={28} className="animate-spin text-brass" />
                        <p className="text-sm lowercase">Waiting for clips...</p>
                        <p className="text-xs text-muted/80 max-w-[26ch] leading-snug">
                          They appear here one by one as each finishes rendering.
                        </p>
                      </div>
                    ) : status === 'error' ? (
                      <div className="h-full min-h-[120px] flex flex-col items-center justify-center text-danger space-y-2">
                        <p>Generation failed.</p>
                      </div>
                    ) : null
                  )}
                </div>
              </div>

            </div>
          )}

        </div>

        {/* Phone navigation. A flex sibling of the scrolling pane, not a fixed
            overlay, so content is never trapped behind it. */}

      </main>

      {/* Missing API Key Modal */}
      <Modal
        isOpen={showKeyModal}
        onClose={() => setShowKeyModal(false)}
        eyebrow="SETUP"
        title="Gemini API Key Required"
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => setShowKeyModal(false)}
              className="btn-ghost flex-1 px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => { setShowKeyModal(false); goToTab('settings'); }}
              className="btn-primary flex-1 px-4 py-2 text-sm"
            >
              Go to Settings
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Add a <strong className="text-ink2">Gemini</strong> API key to generate clips, or configure a local LLM on your server.
          </p>

          {/* Gemini block */}
          <div className={`rounded-input p-4 space-y-2 border ${!apiKey ? 'border-rule2' : 'border-rule opacity-70'}`}>
            <p className="text-xs font-medium text-ink flex items-center gap-2">
              {apiKey ? <Check size={12} className="text-ok" /> : <AlertTriangle size={12} className="text-warn" />}
              Gemini API Key {apiKey && <span className="text-ok">— set</span>}
            </p>
            {!apiKey && (
              <>
                <ol className="text-xs text-muted space-y-1 list-decimal list-inside">
                  <li>Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-brass underline">aistudio.google.com/app/apikey</a></li>
                  <li>Sign in with your Google account</li>
                  <li>Click "Create API Key"</li>
                  <li>Copy the key and paste it below</li>
                </ol>
                <input
                  type="text"
                  placeholder="Paste your Gemini API key here..."
                  className="input-field"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target.value.trim()) {
                      setApiKey(e.target.value.trim());
                    }
                  }}
                />
              </>
            )}
          </div>

        </div>
      </Modal>

      {/* Pre-flight quality gate */}
      {qualityGate && (
        <Modal isOpen={true} onClose={() => setQualityGate(null)} size="md" eyebrow="HEADS UP" title="low source quality">
          <div className="space-y-4">
            <p className="text-sm text-ink2">
              YouTube only offers <span className="text-brass font-semibold">{qualityGate.info.max_height}p</span> for this video
              (below the {qualityGate.info.min_height}p we recommend). Processing anyway will produce lower-quality clips.
            </p>
            {qualityGate.info.cookies_invalid && (
              <p className="text-xs text-muted">
                Your YouTube cookies look expired — refreshing them (export again from an incognito window) often unlocks HD.
              </p>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setQualityGate(null)} className="btn-ghost">cancel</button>
              <button
                onClick={() => { const d = qualityGate.data; setQualityGate(null); handleProcess(d, true); }}
                className="btn-primary"
              >
                process anyway
              </button>
            </div>
          </div>
        </Modal>
      )}


      {editingClip !== null && results?.clips?.[editingClip] && (
        <ClipEditor
          jobId={jobId}
          clipIndex={editingClip}
          clipTitle={results.clips[editingClip].video_title_for_youtube_short || ''}
          onClose={() => setEditingClip(null)}
          onRerendered={handleClipRerendered}
        />
      )}
      {reframingClip !== null && results?.clips?.[reframingClip] && (
        <ReframeEditor
          jobId={jobId}
          clipIndex={reframingClip}
          clipTitle={results.clips[reframingClip].video_title_for_youtube_short || ''}
          onClose={() => setReframingClip(null)}
          onReframed={handleClipRerendered}
        />
      )}
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} queued={typeof peekPendingJob()?.data?.payload === 'string'} />}
      {showSurvey && <OnboardingSurvey onDone={() => setSurveyDone(true)} />}
      {tutorialPhase && !showSurvey && (
        <ClipTutorial
          phase={tutorialPhase}
          jobStatus={status}
          errorText={jobError}
          onStart={startTutorial}
          onSkip={skipTutorial}
          onDismissCelebrate={finishTutorial}
        />
      )}
      {showPlanChoice && <PlanChoiceModal onClose={() => setShowPlanChoice(false)} />}
      {showWmNotice && (
        <WatermarkModal
          source="results"
          jobId={jobId}
          previewSrc={results?.clips?.[0]?.video_url ? getApiUrl(results.clips[0].video_url) : null}
          onUpgrade={openUpsell}
          onClose={() => setShowWmNotice(false)}
        />
      )}
      {showTopUp && (
        <TopUpModal
          onClose={() => setShowTopUp(false)}
          required={topUpInfo.required}
          remaining={topUpInfo.remaining}
          partialMinutes={topUpInfo.partialMinutes}
          onPartial={topUpInfo.onPartial}
          context={topUpInfo.context || 'wall'}
          source={topUpInfo.source}
          highlight={topUpInfo.highlight}
          partialJob={topUpInfo.partialJob}
        />
      )}
      {showTrialUpgrade && (
        <TrialUpgradeModal
          plan={plan}
          onActivated={refreshMe}
          onClose={() => setShowTrialUpgrade(false)}
        />
      )}
    </div>
  );
}

export default App;
