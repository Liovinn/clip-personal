import React, { useState, useEffect, useRef } from 'react';
import { Link2, Upload, FileVideo, X, Info, Loader2, ChevronDown, ArrowRight } from 'lucide-react';
import { track } from '../lib/analytics';
import { getApiUrl } from '../config';

const SUPPORTED_PLATFORMS = [
    'YouTube', 'Vimeo', 'TikTok', 'X / Twitter', 'Twitch',
    'Facebook', 'Instagram', 'Dailymotion', 'Reddit', 'Streamable',
];

// Mirrors the server's MIN_SOURCE_SECONDS: shorter sources are rejected with a
// 400 after the whole file was uploaded. Checking the duration in the browser
// says so the moment the file is picked (a 27 s upload used to end in a bare
// "That run failed").
const MIN_SOURCE_SECONDS = 45;

// Duration of a local video file in seconds, or null when the browser cannot
// read it (unsupported codec): then the server stays the judge.
const readVideoDuration = (file) => new Promise((resolve) => {
    try {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        const done = (d) => { URL.revokeObjectURL(url); resolve(d); };
        v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
        v.onerror = () => done(null);
        setTimeout(() => done(null), 8000);
        v.src = url;
    } catch { resolve(null); }
});

export default function MediaInput({ onProcess, isProcessing }) {
    const [youtubeUrlEnabled, setYoutubeUrlEnabled] = useState(true);
    // File upload is the primary path; the link is secondary.
    const [mode, setMode] = useState('file'); // 'file' | 'url'
    const [url, setUrl] = useState('');
    const [file, setFile] = useState(null);
    const [fileSeconds, setFileSeconds] = useState(null);
    const fileTooShort = fileSeconds != null && fileSeconds < MIN_SOURCE_SECONDS;
    const [outputFormat, setOutputFormat] = useState('vertical'); // vertical | horizontal | square
    const [showInfo, setShowInfo] = useState(false);
    // Advanced generation controls — empty string means "let the AI decide",
    // which keeps the default pipeline behavior untouched.
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [targetClips, setTargetClips] = useState('');
    const [clipMinSeconds, setClipMinSeconds] = useState('');
    const [clipMaxSeconds, setClipMaxSeconds] = useState('');
    // Auto-hook: burn the AI hook text into every clip. On by default; the
    // choice persists so turning it off sticks across sessions.
    const [autoHook, setAutoHook] = useState(() => {
        try { return localStorage.getItem('os_auto_hook') !== '0'; } catch { return true; }
    });
    const [autoHookStyle, setAutoHookStyle] = useState(() => {
        // v2 key: the default became 'pill'; an old saved 'classic' was just the old default.
        try { return localStorage.getItem('os_auto_hook_style_v2') || 'pill'; } catch { return 'pill'; }
    });
    // Layout: 'auto' lets the AI pick per video (server default); the others
    // force one on so a podcast host who knows what they uploaded doesn't
    // depend on the detector, and 'none' keeps the plain single crop.
    const [layout, setLayout] = useState(() => {
        try { return localStorage.getItem('os_layout') || 'auto'; } catch { return 'auto'; }
    });
    const infoRef = useRef(null);

    // Close the compatibility popover on any outside click.
    useEffect(() => {
        if (!showInfo) return;
        const onClick = (e) => {
            if (infoRef.current && !infoRef.current.contains(e.target)) setShowInfo(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [showInfo]);

    useEffect(() => {
        let cancelled = false;
        setFileSeconds(null);
        if (!file) return undefined;
        readVideoDuration(file).then((d) => {
            if (cancelled) return;
            setFileSeconds(d);
            if (d != null && d < MIN_SOURCE_SECONDS) {
                track('SourceTooShort', { props: { seconds: String(Math.round(d)) } });
            }
        });
        return () => { cancelled = true; };
    }, [file]);

    useEffect(() => {
        fetch(getApiUrl('/api/config'))
            .then((r) => r.ok ? r.json() : null)
            .then((cfg) => {
                if (cfg && cfg.youtubeUrlEnabled === false) {
                    setYoutubeUrlEnabled(false);
                    setMode('file');
                }
            })
            .catch(() => {});
    }, []);

    // A link pasted in the landing hero: preload it here so the user picks up
    // where they left off. The user starts processing with Generate Clips.
    useEffect(() => {
        let pending = null;
        try {
            pending = localStorage.getItem('os_pending_url');
            if (pending) localStorage.removeItem('os_pending_url');
        } catch { /* ignore */ }
        if (pending) {
            setMode('url');
            setUrl(pending);
        }
    }, []);

    const handleSubmit = (e) => {
        e.preventDefault();
        const advanced = {
            targetClips: targetClips || null,
            clipMinSeconds: clipMinSeconds || null,
            clipMaxSeconds: clipMaxSeconds || null,
            autoHook,
            autoHookStyle,
            layout,
        };
        try {
            localStorage.setItem('os_auto_hook', autoHook ? '1' : '0');
            localStorage.setItem('os_auto_hook_style_v2', autoHookStyle);
            localStorage.setItem('os_layout', layout);
        } catch { /* ignore */ }
        if (mode === 'url' && url) {
            onProcess({ type: 'url', payload: url, outputFormat, ...advanced });
        } else if (mode === 'file' && file && !fileTooShort) {
            onProcess({ type: 'file', payload: file, outputFormat, ...advanced });
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            setFile(e.dataTransfer.files[0]);
            setMode('file');
        }
    };

    return (
        <div className="clipedit-input-panel card animate-fade">
            <div className="clipedit-panel-heading">
                <h2>Source video</h2>
            </div>
            <div className="clipedit-source-tabs flex gap-2 mb-6" data-tutorial="source-tabs">
                <button
                    onClick={() => setMode('file')}
                    aria-pressed={mode === 'file'}
                    className={`clipedit-source-tab flex items-center gap-2 text-sm whitespace-nowrap transition-colors ${mode === 'file'
                        ? 'text-ink border-brass'
                        : 'text-muted border-transparent hover:text-ink2'
                        }`}
                >
                    <Upload size={16} className={`hidden sm:block ${mode === 'file' ? 'text-brass' : ''}`} />
                    Upload file
                </button>
                {youtubeUrlEnabled && (
                    <button
                        onClick={() => setMode('url')}
                        aria-pressed={mode === 'url'}
                        className={`clipedit-source-tab flex items-center gap-2 text-sm whitespace-nowrap transition-colors ${mode === 'url'
                            ? 'text-ink border-brass'
                            : 'text-muted border-transparent hover:text-ink2'
                            }`}
                    >
                        <Link2 size={16} className={`hidden sm:block ${mode === 'url' ? 'text-brass' : ''}`} />
                        Video URL
                    </button>
                )}
            </div>

            <form onSubmit={handleSubmit}>
                {mode === 'url' ? (
                    <div className="space-y-4" data-tutorial="drop-zone">
                        <div className="relative">
                            <input
                                type="url"
                                aria-label="Video URL"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="Paste a video link (https://...)"
                                className="input-field pr-11"
                                required
                            />
                            <div className="absolute inset-y-0 right-2 flex items-center" ref={infoRef}>
                                <button
                                    type="button"
                                    onClick={() => setShowInfo((v) => !v)}
                                    aria-label="Supported platforms"
                                    className="p-1.5 text-muted hover:text-brass transition-colors"
                                >
                                    <Info size={16} />
                                </button>
                                {showInfo && (
                                    <div className="absolute right-0 top-full mt-2 w-64 z-20 card p-4 text-left animate-fade">
                                        <p className="eyebrow mb-2">Paste a link from</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {SUPPORTED_PLATFORMS.map((p) => (
                                                <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-paper3 text-ink2">
                                                    {p}
                                                </span>
                                            ))}
                                        </div>
                                        <p className="text-xs text-muted mt-2.5 leading-relaxed">
                                            …and 1,000+ more sites. If a link has a public video, we can usually fetch it.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div
                        data-tutorial="drop-zone"
                        className={`clipedit-upload-area border-2 border-dashed rounded-card p-6 sm:p-8 text-center transition-colors ${file ? 'border-brass' : 'border-rule2 hover:border-brass'
                            }`}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleDrop}
                    >
                        {file ? (
                            <div className="flex items-center justify-center gap-3 text-ok min-w-0">
                                <FileVideo size={18} className="shrink-0" />
                                <span className="font-medium truncate">{file.name}</span>
                                <button
                                    type="button"
                                    onClick={() => setFile(null)}
                                    aria-label="Remove selected video"
                                    className="p-1 text-muted hover:text-ink hover:bg-paper3 rounded-full transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        ) : null}
                        {file && fileTooShort ? (
                            <p className="text-danger text-sm mt-3" role="alert">
                                This video is {Math.round(fileSeconds)}s long. Clip generation needs at least {MIN_SOURCE_SECONDS}s
                                of footage to cut from: it already is a short. Pick a longer video.
                            </p>
                        ) : null}
                        {!file && (
                            <label className="cursor-pointer block">
                                <input
                                    type="file"
                                    accept="video/*"
                                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    className="hidden"
                                />
                                <Upload className="mx-auto mb-3 text-muted" size={18} />
                                <p className="text-ink2"><span className="ce-upload-link">Choose a file</span> or drag it here</p>
                                <p className="ce-upload-help">MP4, MOV · Up to 500 MB · At least {MIN_SOURCE_SECONDS} seconds</p>
                            </label>
                        )}
                    </div>
                )}

                {/* Output format selector */}
                <div className="mt-5" data-tutorial="output-format">
                    <p className="eyebrow mb-2">Output format</p>
                    <div className="grid grid-cols-3 gap-2">
                        {[
                            { value: 'vertical', label: '9:16', hint: 'Shorts · Reels · TikTok', w: 18, h: 32 },
                            { value: 'square', label: '1:1', hint: 'Feed posts', w: 28, h: 28 },
                            { value: 'horizontal', label: '16:9', hint: 'Keep landscape · YouTube', w: 36, h: 20 },
                        ].map((f) => {
                            const active = outputFormat === f.value;
                            return (
                                <button
                                    key={f.value}
                                    type="button"
                                    onClick={() => setOutputFormat(f.value)}
                                    aria-pressed={active}
                                    className={`clipedit-format-option rounded-input border transition-colors
                                        ${active ? 'is-selected border-[color:var(--color-accent)] text-ink' : 'border-rule2 text-muted hover:border-[color:var(--color-accent)]'}`}
                                >
                                    {/* Aspect-ratio glyph */}
                                    <span
                                        className="rounded-[3px] border-2 transition-colors"
                                        style={{
                                            width: `${f.w}px`,
                                            height: `${f.h}px`,
                                            borderColor: active ? 'var(--color-accent)' : 'var(--color-rule-2)',
                                            backgroundColor: active ? 'color-mix(in srgb, var(--color-accent) 22%, transparent)' : 'transparent',
                                        }}
                                    />
                                    <span className="ce-format-copy"><span className="ce-format-ratio">{f.label}</span><span className="ce-format-hint">{f.hint}</span></span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Advanced generation controls — collapsed by default; blank = AI decides */}
                <div className="mt-4">
                    <button
                        type="button"
                        onClick={() => setShowAdvanced((v) => !v)}
                        aria-expanded={showAdvanced}
                        aria-controls="clipedit-advanced-options"
                        className="flex items-center gap-1.5 text-xs text-muted hover:text-ink2 lowercase transition-colors"
                    >
                        <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                        Advanced options
                        {(targetClips || clipMinSeconds || clipMaxSeconds || !autoHook) && (
                            <span className="text-brass">·</span>
                        )}
                    </button>
                    {showAdvanced && (
                        /* Stacked on a phone: three number fields side by side leaves
                           ~100px each, which crushes both label and value. */
                        <div id="clipedit-advanced-options" className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-2 animate-fade">
                            <div>
                                <label htmlFor="clipedit-target-clips" className="eyebrow mb-1.5">Target clip count</label>
                                <input
                                    id="clipedit-target-clips"
                                    type="number" min="1" max="15" step="1"
                                    value={targetClips}
                                    onChange={(e) => setTargetClips(e.target.value)}
                                    placeholder="auto"
                                    className="input-field"
                                />
                            </div>
                            <div>
                                <label htmlFor="clipedit-min-length" className="eyebrow mb-1.5">Min length (seconds)</label>
                                <input
                                    id="clipedit-min-length"
                                    type="number" min="5" max="175" step="1"
                                    value={clipMinSeconds}
                                    onChange={(e) => setClipMinSeconds(e.target.value)}
                                    placeholder="15"
                                    className="input-field"
                                />
                            </div>
                            <div>
                                <label htmlFor="clipedit-max-length" className="eyebrow mb-1.5">Max length (seconds)</label>
                                <input
                                    id="clipedit-max-length"
                                    type="number" min="10" max="180" step="1"
                                    value={clipMaxSeconds}
                                    onChange={(e) => setClipMaxSeconds(e.target.value)}
                                    placeholder="60"
                                    className="input-field"
                                />
                            </div>
                            <p className="col-span-1 sm:col-span-3 text-[11px] leading-relaxed text-muted">
                                Targets, not guarantees: the AI returns fewer clips when the
                                material doesn't hold them. Leave blank to let it decide.
                            </p>
                            <div className="col-span-1 sm:col-span-3 flex flex-wrap items-center justify-between gap-3 pt-3 sm:pt-1 border-t border-rule">
                                <span className="text-xs text-ink2">Vertical layout</span>
                                <select
                                    value={layout}
                                    onChange={(e) => setLayout(e.target.value)}
                                    className="input-field !w-auto text-xs py-1.5"
                                    aria-label="Vertical layout"
                                >
                                    <option value="auto">Auto (AI picks per video)</option>
                                    <option value="split">Two speakers stacked</option>
                                    <option value="screencast">Screen over presenter</option>
                                    <option value="none">Single crop only</option>
                                </select>
                            </div>
                            <div className="col-span-1 sm:col-span-3 flex flex-wrap items-center justify-between gap-3 pt-3 sm:pt-1 border-t border-rule">
                                <label className="flex items-center gap-2 text-xs text-ink2 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={autoHook}
                                        onChange={(e) => setAutoHook(e.target.checked)}
                                        className="w-4 h-4 shrink-0 accent-[var(--color-accent)] cursor-pointer"
                                    />
                                    Auto hook titles on clips
                                </label>
                                {autoHook && (
                                    <select
                                        aria-label="Hook title style"
                                        value={autoHookStyle}
                                        onChange={(e) => setAutoHookStyle(e.target.value)}
                                        className="input-field !w-auto text-xs py-1.5"
                                    >
                                        <option value="pill">Pills</option>
                                        <option value="classic">Classic</option>
                                        <option value="dark">Dark</option>
                                        <option value="yellow">Yellow</option>
                                        <option value="red">Red</option>
                                        <option value="outline">Outline</option>
                                        <option value="outline_yellow">Outline+</option>
                                    </select>
                                )}
                                {autoHook && (
                                    <p className="w-full text-[11px] leading-relaxed text-muted">
                                        You can change each clip&apos;s hook text, style, position and size
                                        afterwards with its hook button.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <button
                    type="submit"
                    data-tutorial="generate"
                    disabled={isProcessing || (mode === 'url' && !url) || (mode === 'file' && (!file || fileTooShort))}
                    className="clipedit-generate w-full btn-primary mt-5"
                >
                    {isProcessing ? (
                        <>
                            <Loader2 size={16} className="animate-spin" />
                            Processing video…
                        </>
                    ) : (
                        <>
                            Generate clips <ArrowRight size={17} />
                        </>
                    )}
                </button>
            </form>
        </div>
    );
}
