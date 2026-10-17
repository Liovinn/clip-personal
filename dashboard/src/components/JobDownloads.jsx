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
    const controller = new AbortController();
    if (allowDrive) {
      apiJson('/api/exports/drive-config', { signal: controller.signal })
        .then((config) => setDriveEnabled(config.enabled))
        .catch(() => setDriveEnabled(false));
    }
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, [jobId, allowDrive]);

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
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}
