import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud, Download, Loader2 } from 'lucide-react';
import { apiJson } from '../lib/api';
import { getApiUrl } from '../config';

const GUIDE = 'https://github.com/Liovinn/clip-personal/blob/main/docs/VAST_QUICKSTART.md#save-to-google-drive-optional';
const sizeLabel = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function JobDownloads({ jobId, allowDrive = false }) {
  const [busy, setBusy] = useState('');
  const [archive, setArchive] = useState(null);
  const [driveEnabled, setDriveEnabled] = useState(false);
  const [vpsEnabled, setVpsEnabled] = useState(false);
  const [vps, setVps] = useState(null);
  const [vpsPollError, setVpsPollError] = useState('');
  const [vpsLinkCopied, setVpsLinkCopied] = useState(false);
  const [transfer, setTransfer] = useState(null);
  const [error, setError] = useState('');
  const [handedOff, setHandedOff] = useState(false);
  const active = useRef(null);

  useEffect(() => {
    setArchive(null);
    setTransfer(null);
    setError('');
    setBusy('');
    setHandedOff(false);
    setVps(null);
    setVpsPollError('');
    setVpsLinkCopied(false);
    setVpsEnabled(false);
    const controller = new AbortController();
    if (allowDrive) {
      apiJson('/api/exports/vps-config', { signal: controller.signal })
        .then((config) => {
          setVpsEnabled(config.enabled);
          if (config.enabled) {
            apiJson(`/api/jobs/${encodeURIComponent(jobId)}/export-vps`, { signal: controller.signal })
              .then(setVps).catch(() => {});
          }
        }).catch(() => setVpsEnabled(false));
      apiJson('/api/exports/drive-config', { signal: controller.signal })
        .then((config) => setDriveEnabled(config.enabled))
        .catch(() => setDriveEnabled(false));
    }
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, [jobId, allowDrive]);

  useEffect(() => {
    if (!vps || !['queued', 'uploading'].includes(vps.status)) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      apiJson(`/api/jobs/${encodeURIComponent(jobId)}/export-vps`, { signal: controller.signal })
        .then((result) => { setVps(result); setVpsPollError(''); })
        .catch(() => {
          if (!controller.signal.aborted) setVpsPollError('Cannot check upload status. Check your connection and keep Vast running until verification appears.');
        });
    }, 2000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [jobId, vps]);

  const saveVps = async () => {
    if (!jobId || busy) return;
    setBusy('vps');
    setVpsLinkCopied(false);
    setVpsPollError('');
    setError('');
    const controller = new AbortController();
    active.current = controller;
    try {
      const result = await apiJson(`/api/jobs/${encodeURIComponent(jobId)}/export-vps`, {
        method: 'POST', signal: controller.signal,
      });
      if (!controller.signal.aborted) setVps(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.detail || failure.message);
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy('');
    }
  };

  const download = async (toDrive = false) => {
    if (!jobId || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(toDrive ? 'drive' : 'download');
    setError('');
    try {
      const path = `/api/jobs/${encodeURIComponent(jobId)}/${toDrive ? 'export-drive' : 'download-all'}`;
      const result = await apiJson(path, { method: 'POST', signal: controller.signal });
      if (controller.signal.aborted) return;
      if (toDrive) {
        setTransfer(result);
      } else {
        setArchive(result);
        // Let the browser stream to disk and display real progress/resume.
        // Do not fetch a 250MB+ Blob before opening the Downloads panel.
        const anchor = document.createElement('a');
        anchor.href = getApiUrl(result.url);
        anchor.download = result.filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setHandedOff(true);
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure.detail || (failure instanceof TypeError
          ? 'Connection lost. Check the server connection, then retry; your ZIP stays on the server.'
          : failure.message));
      }
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy('');
    }
  };

  return (
    <div className="space-y-2 min-w-0">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <button onClick={() => download()} disabled={!!busy} className="btn-ghost px-3 py-2 text-xs">
          {busy === 'download' ? <><Loader2 size={14} className="animate-spin" />preparing ZIP…</>
            : <><Download size={14} />{handedOff ? 'download ZIP again' : 'download all'}{archive ? ` · ${sizeLabel(archive.size_bytes)}` : ''}</>}
        </button>
        {allowDrive && <button onClick={() => download(true)} disabled={!!busy || !driveEnabled || !!transfer}
          title={driveEnabled ? 'Copy the ZIP directly from Vast to Google Drive' : 'Connect Google Drive in Vast first'}
          className="btn-ghost px-3 py-2 text-xs">
          {busy === 'drive' ? <><Loader2 size={14} className="animate-spin" />requesting upload…</>
            : <><UploadCloud size={14} />{transfer ? 'upload requested' : 'save to Drive'}</>}
        </button>}
        {vpsEnabled && <button onClick={saveVps}
          disabled={!!busy || ['queued', 'uploading'].includes(vps?.status)}
          className="btn-ghost px-3 py-2 text-xs">
          {busy === 'vps' ? <><Loader2 size={14} className="animate-spin" />preparing ZIP…</>
            : ['queued', 'uploading'].includes(vps?.status)
            ? <><Loader2 size={14} className="animate-spin" />saving to VPS…</>
            : <><UploadCloud size={14} />{vps?.status === 'completed' ? 'save to VPS again' : 'save to VPS'}</>}
        </button>}
      </div>
      {handedOff && <p className="text-xs text-muted" role="status">
        ZIP ready{archive ? ` · ${sizeLabel(archive.size_bytes)}` : ''}. Check your browser’s Downloads for progress, pause, and resume. Keep this instance running until it finishes.
      </p>}
      {allowDrive && !driveEnabled && <p className="text-xs text-muted sm:text-right">
        <a href={GUIDE} target="_blank" rel="noopener noreferrer" className="underline">Connect Google Drive</a> to save clips without downloading them to this computer first.
      </p>}
      {transfer && <div className="text-xs text-muted space-y-1" role="status">
        <p>Upload requested · {sizeLabel(transfer.size_bytes)}. This is not a completion confirmation.</p>
        <p>Check <a href={transfer.console_url} target="_blank" rel="noopener noreferrer" className="underline">Cloud Copy in Vast</a>, then verify the ZIP in Google Drive before destroying the instance.</p>
        <p className="break-all">Drive folder: {transfer.folder}</p>
      </div>}
      {['queued', 'uploading'].includes(vps?.status) && <p className="text-xs text-muted" role="status">
        {vps.status === 'queued' ? 'VPS upload queued.'
          : `Sending to VPS: ${sizeLabel(vps.sent_bytes || 0)} / ${sizeLabel(vps.size_bytes)}. Waiting for checksum verification.`}
        {' '}Keep the Vast instance running until the upload is verified.
      </p>}
      {vps?.status === 'completed' && vps.confirmed && <div className="text-xs text-muted space-y-1" role="status">
        <p>VPS copy verified · {sizeLabel(vps.size_bytes)}. This copy remains available after the Vast instance is destroyed.</p>
        <p><a href={vps.url} target="_blank" rel="noopener noreferrer" className="underline">Download ZIP from VPS</a>
          {' '}· Link expires {new Date(vps.expires_at * 1000).toLocaleString()}.</p>
        <button className="underline" onClick={async () => {
          try { await navigator.clipboard.writeText(vps.url); setVpsLinkCopied(true); }
          catch { setError('Copy unavailable. Use your browser’s Copy Link Address on the download link.'); }
        }}>{vpsLinkCopied ? 'Link copied' : 'Copy download link'}</button>
        <p>Save the download link before closing this app. Anyone with the link can download this ZIP until it expires.</p>
      </div>}
      {vps?.status === 'failed' && <p className="text-xs text-danger" role="alert">{vps.error}</p>}
      {vpsPollError && <p className="text-xs text-danger" role="alert">{vpsPollError}</p>}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}
