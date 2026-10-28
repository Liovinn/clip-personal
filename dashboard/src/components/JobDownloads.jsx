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
          if (!controller.signal.aborted) setVpsPollError('Status unggahan tidak dapat diperiksa. Periksa koneksi dan biarkan Vast tetap aktif hingga verifikasi muncul.');
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
          ? 'Koneksi terputus. Periksa koneksi server lalu coba lagi; ZIP tetap tersimpan di server.'
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
          {busy === 'download' ? <><Loader2 size={14} className="animate-spin" />Menyiapkan ZIP…</>
            : <><Download size={14} />{handedOff ? "Unduh ulang ZIP" : "Unduh semua"}{archive ? ` · ${sizeLabel(archive.size_bytes)}` : ''}</>}
        </button>
        {allowDrive && <button onClick={() => download(true)} disabled={!!busy || !driveEnabled || !!transfer}
          title={driveEnabled ? "Salin ZIP langsung dari Vast ke Google Drive" : "Hubungkan Google Drive di Vast terlebih dahulu"}
          className="btn-ghost px-3 py-2 text-xs">
          {busy === 'drive' ? <><Loader2 size={14} className="animate-spin" />Meminta unggahan…</>
            : <><UploadCloud size={14} />{transfer ? "Unggahan diminta" : "Simpan ke Drive"}</>}
        </button>}
        {vpsEnabled && <button onClick={saveVps}
          disabled={!!busy || ['queued', 'uploading'].includes(vps?.status)}
          className="btn-ghost px-3 py-2 text-xs">
          {busy === 'vps' ? <><Loader2 size={14} className="animate-spin" />Menyiapkan ZIP…</>
            : ['queued', 'uploading'].includes(vps?.status)
            ? <><Loader2 size={14} className="animate-spin" />Menyimpan ke VPS…</>
            : <><UploadCloud size={14} />{vps?.status === 'completed' ? "Simpan ulang ke VPS" : "Simpan ke VPS"}</>}
        </button>}
      </div>
      {handedOff && <p className="text-xs text-muted" role="status">
        ZIP siap{archive ? ` · ${sizeLabel(archive.size_bytes)}` : ''}. Lihat progres di menu Unduhan browser. Unduhan bisa dijeda dan dilanjutkan. Biarkan instans tetap aktif hingga selesai.
      </p>}
      {allowDrive && !driveEnabled && <p className="text-xs text-muted sm:text-right">
        <a href={GUIDE} target="_blank" rel="noopener noreferrer" className="underline">Hubungkan Google Drive</a> untuk menyimpan klip tanpa mengunduhnya ke komputer ini terlebih dahulu.
      </p>}
      {transfer && <div className="text-xs text-muted space-y-1" role="status">
        <p>Unggahan diminta · {sizeLabel(transfer.size_bytes)}. Ini belum berarti unggahan selesai.</p>
        <p>Periksa <a href={transfer.console_url} target="_blank" rel="noopener noreferrer" className="underline">Cloud Copy di Vast</a>, lalu pastikan ZIP sudah ada di Google Drive sebelum menghapus instans.</p>
        <p className="break-all">Folder Drive: {transfer.folder}</p>
      </div>}
      {['queued', 'uploading'].includes(vps?.status) && <p className="text-xs text-muted" role="status">
        {vps.status === 'queued' ? "Unggahan ke VPS masuk antrean."
          : `Mengirim ke VPS: ${sizeLabel(vps.sent_bytes || 0)} / ${sizeLabel(vps.size_bytes)}. Menunggu verifikasi checksum.`}
        {' '}Biarkan instans Vast tetap aktif hingga unggahan terverifikasi.
      </p>}
      {vps?.status === 'completed' && vps.confirmed && <div className="text-xs text-muted space-y-1" role="status">
        <p>Salinan VPS terverifikasi · {sizeLabel(vps.size_bytes)}. Salinan ini tetap tersedia setelah instans Vast dihapus.</p>
        <p><a href={vps.url} target="_blank" rel="noopener noreferrer" className="underline">Unduh ZIP dari VPS</a>
          {' '}· Tautan kedaluwarsa {new Date(vps.expires_at * 1000).toLocaleString('id-ID')}.</p>
        <button className="underline" onClick={async () => {
          try { await navigator.clipboard.writeText(vps.url); setVpsLinkCopied(true); }
          catch { setError('Tautan tidak dapat disalin otomatis. Gunakan menu Salin alamat tautan pada browser.'); }
        }}>{vpsLinkCopied ? "Tautan disalin" : "Salin tautan unduhan"}</button>
        <p>Simpan tautan unduhan sebelum menutup aplikasi. Siapa pun yang memiliki tautan dapat mengunduh ZIP ini hingga tautannya kedaluwarsa.</p>
      </div>}
      {vps?.status === 'failed' && <p className="text-xs text-danger" role="alert">{vps.error}</p>}
      {vpsPollError && <p className="text-xs text-danger" role="alert">{vpsPollError}</p>}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}
