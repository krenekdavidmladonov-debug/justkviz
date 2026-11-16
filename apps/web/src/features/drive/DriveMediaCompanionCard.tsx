import { useEffect, useRef, useState } from 'react';
import { configureDriveMediaCompanion, type DriveMediaCompanionStatus } from './api';

/** Pairing codes remain in this mounted owner's view, never in URLs or browser storage. */
export function DriveMediaCompanionCard() {
  const [status, setStatus] = useState<DriveMediaCompanionStatus | null>(null);
  const [pending, setPending] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false), [now, setNow] = useState(Date.now);
  const alive = useRef(false), busy = useRef(false);
  useEffect(() => {
    let active = true; alive.current = true;
    void configureDriveMediaCompanion('status').then(value => { if (active) setStatus(value); })
      .catch(() => { if (active) setError('Stav počítače se nepodařilo načíst. Obnovte stav.'); })
      .finally(() => { if (active) setPending(false); });
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => { active = false; alive.current = false; clearInterval(timer); };
  }, []);
  async function run(action: 'pair' | 'status' | 'revoke') {
    if (pending || busy.current) return;
    busy.current = true; setPending(true); setError(''); setNotice('');
    try {
      const next = await configureDriveMediaCompanion(action);
      if (alive.current) {
        // Status polling never prolongs or persists the one-time pairing code.
        setStatus(old => action === 'status' && !next.paired && old?.pairingCode
          ? { ...next, pairingCode: old.pairingCode, pairingExpiresAt: old.pairingExpiresAt } : next);
        setNow(Date.now()); setConfirmRevoke(false);
        if (action === 'revoke') setNotice('Počítač byl odpojen. Hotová média zůstávají dostupná.');
      }
    } catch { if (alive.current) setError('Operaci s počítačem se nepodařilo dokončit. Zkuste to znovu.'); }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }
  const paired = status?.paired && (status.expiresAt === undefined || status.expiresAt > now);
  const online = paired && status?.lastSeen !== undefined && status.lastSeen > now - 90_000;
  const code = status?.pairingCode && status.pairingExpiresAt !== undefined && status.pairingExpiresAt > now ? status.pairingCode : null;
  return <div role="group" aria-labelledby="drive-companion-heading" aria-busy={pending}>
    <h3 id="drive-companion-heading">Počítač pro přípravu ukázek</h3>
    <p>Windows pomocník připraví z YouTube zvolený úsek a uloží jej na váš soukromý Google Disk. Při přípravě musí být spuštěný. Hotové ukázky pak přehrajete na libovolném zařízení.</p>
    {pending && <p role="status">Načítám stav počítače…</p>}
    {status && <p role="status">{!status.enabled ? 'Příprava na počítači zatím není aktivovaná.' : paired && status.processing ? 'Počítač připravuje ukázku.' : online ? 'Počítač je připravený.' : paired ? 'Počítač se nedávno neohlásil. Pokud právě nepřipravuje ukázku, spusťte Windows pomocníka; uložené úlohy na něj počkají.' : 'Počítač zatím není spárovaný.'}</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {code && <div>
      <p>Spusťte Windows pomocníka a tento jednorázový kód vložte do jeho výzvy pro párování. Platí 5 minut; po použití jej nelze použít znovu.</p>
      <label>Párovací kód <input type="text" readOnly autoComplete="off" value={code} onFocus={event => event.currentTarget.select()} /></label>
      <button type="button" className="secondary-button" disabled={pending} onClick={() => {
        void navigator.clipboard?.writeText(code).then(() => { if (alive.current) setNotice('Párovací kód byl zkopírován.'); })
          .catch(() => { if (alive.current) setNotice('Kód označte a zkopírujte ručně.'); });
        if (!navigator.clipboard) setNotice('Kód označte a zkopírujte ručně.');
      }}>Kopírovat kód</button>
    </div>}
    {status?.pairingCode && !code && !paired && <p role="status">Platnost párovacího kódu vypršela. Vytvořte nový kód.</p>}
    {status?.enabled && <button type="button" className="secondary-button" disabled={pending} onClick={() => void run('pair')}>{paired ? 'Spárovat jiný počítač' : code ? 'Vytvořit nový kód' : 'Spárovat počítač'}</button>}
    <button type="button" className="secondary-button" disabled={pending} onClick={() => void run('status')}>Obnovit stav počítače</button>
    {(paired || code) && (!confirmRevoke ? <button type="button" className="secondary-button" disabled={pending} onClick={() => setConfirmRevoke(true)}>Odpojit počítač</button> : <div role="group" aria-label="Potvrzení odpojení počítače">
      <p>Odpojit počítač a zrušit párovací kód? Pro další přípravu bude potřeba nové spárování.</p>
      <button type="button" className="danger-button" disabled={pending} onClick={() => void run('revoke')}>Potvrdit odpojení počítače</button>
      <button type="button" className="secondary-button" disabled={pending} onClick={() => setConfirmRevoke(false)}>Zrušit</button>
    </div>)}
  </div>;
}
