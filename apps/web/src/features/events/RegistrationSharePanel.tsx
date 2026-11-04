import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { readFirebaseConfig } from '../../services/firebase/config';
import { publicRegistrationUrl, qrFilename, registrationQr, registrationSharingState } from './registrationSharing';
import type { EventRecord } from './types';

export function RegistrationSharePanel({ event }: { event: EventRecord }) {
  const config = readFirebaseConfig();
  const url = publicRegistrationUrl(event.id, { projectId: config.options.projectId ?? '', useEmulators: config.useEmulators }, window.location.origin);
  const [now, setNow] = useState(Date.now);
  const [notice, setNotice] = useState('');
  const [qr, setQr] = useState<{ png: string; svg: string } | null>(null);
  const [pending, setPending] = useState(false);
  const text = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const state = registrationSharingState(event, now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!qr) return;
    const modal = dialog.current;
    const previous = document.activeElement;
    modal?.showModal();
    return () => { modal?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [qr]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setNotice('Odkaz zkopírován'); }
    catch { text.current?.focus(); text.current?.select(); setNotice('Označený odkaz zkopírujte ručně (Ctrl+C nebo nabídka Kopírovat).'); }
  };
  return <section className="event-section registration-share-panel"><h2>Přihlášení týmů</h2><p>{state.message}</p>
    {state.available ? <>
      <label className="form-field"><span>Veřejný odkaz</span><textarea ref={text} className="registration-share-url" readOnly rows={2} value={url} /></label>
      <div className="team-tool-actions"><button className="secondary-button" type="button" onClick={() => void copy()}>Kopírovat odkaz</button><a className="secondary-link" href={url} target="_blank" rel="noopener noreferrer">Otevřít formulář</a><button className="secondary-button" type="button" disabled={pending} onClick={() => { setPending(true); void registrationQr(url).then(setQr).catch(() => setNotice('QR se nepodařilo vytvořit.')).finally(() => setPending(false)); }}>Zobrazit QR</button></div>
      {notice && <p role="status">{notice}</p>}
      {qr && <dialog ref={dialog} className="team-tool-dialog qr-dialog" aria-labelledby="registration-qr-title" onCancel={() => setQr(null)}><h2 id="registration-qr-title">QR pro přihlášení týmů</h2><p>{event.title}</p><img src={qr.png} alt="QR pro přihlášení týmů" /><p className="registration-share-url">{url}</p><div className="team-tool-actions"><a className="secondary-link" href={qr.png} download={`${qrFilename(event.title)}.png`}>Stáhnout PNG</a><a className="secondary-link" href={qr.svg} download={`${qrFilename(event.title)}.svg`}>Stáhnout SVG</a><button className="secondary-button" type="button" onClick={() => setQr(null)}>Zavřít</button></div></dialog>}
    </> : <Link className="secondary-link" to={`/admin/events/${event.id}`}>Zveřejnění na detailu akce</Link>}
  </section>;
}
