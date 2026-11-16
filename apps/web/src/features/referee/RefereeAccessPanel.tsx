import { useEffect, useRef, useState } from 'react';
import { getFirebaseAppContext } from '../../services/firebase/app';
import { refereeCall, type Access } from './api';
import { refereeQr, refereeUrl } from './sharing';
const localExpiry = () => { const date = new Date(Date.now() + 86400000); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16); };
export function RefereeAccessPanel({ eventId, canIssue }: { eventId: string; canIssue: boolean }) {
  const [accesses, setAccesses] = useState<Access[]>([]), [name, setName] = useState('Rozhodčí 1'), [expires, setExpires] = useState(localExpiry);
  const [notice, setNotice] = useState(''), [pending, setPending] = useState(false), [issued, setIssued] = useState<{ url: string; png: string | null } | null>(null);
  const linkField = useRef<HTMLInputElement>(null);
  const issuance = useRef<{ requestId: string; label: string; expiresAt: string } | null>(null);
  async function load() { setAccesses(await refereeCall<Access[]>('listRefereeAccess', { eventId })); }
  useEffect(() => { let active = true; void refereeCall<Access[]>('listRefereeAccess', { eventId }).then(data => { if (active) setAccesses(data); }).catch(() => { if (active) setNotice('Přístupy se nepodařilo načíst.'); }); return () => { active = false; }; }, [eventId]);
  async function perform(action: 'issue' | 'rotate' | 'revoke', access?: Access) {
    if (pending || (action !== 'revoke' && !canIssue)) return;
    if (action === 'rotate' && !window.confirm('Obnovit klíč? Starý QR i všechny otevřené přístupy se starým klíčem přestanou fungovat.')) return;
    if (action === 'revoke' && !window.confirm('Odebrat tento přístup včetně již otevřených panelů?')) return;
    setPending(true); setNotice('');
    try {
      let result: Access & { key: string | null };
      if (action === 'issue') {
        // Preserve an uncertain request until explicitly acknowledged, avoiding invisible duplicate grants.
        issuance.current ??= { requestId: crypto.randomUUID(), label: name, expiresAt: new Date(expires).toISOString() };
        result = await refereeCall('issueRefereeAccess', { eventId, ...issuance.current }); issuance.current = null;
      } else result = await refereeCall('changeRefereeAccess', { eventId, accessId: access!.accessId, expectedVersion: access!.version, action, ...(action === 'rotate' ? { expiresAt: new Date(expires).toISOString() } : {}) });
      if (result.key) {
        const url = refereeUrl({ eventId, accessId: result.accessId, key: result.key }, { projectId: getFirebaseAppContext().config.options.projectId ?? '', useEmulators: getFirebaseAppContext().config.useEmulators }, window.location.origin);
        // Keep the one-time link even if optional QR generation or list refresh fails.
        setIssued({ url, png: null });
        try { const png = await refereeQr(url); setIssued(current => current?.url === url ? { url, png } : current); }
        catch { setNotice('QR se nepodařilo vytvořit. Soukromý odkaz můžete zkopírovat a předat rozhodčímu.'); }
      } else {
        if (action === 'revoke') setIssued(null);
        setNotice(action === 'revoke' ? 'Přístup byl odebrán.' : 'Přístup již existuje. Klíč nelze znovu přečíst; použijte výslovnou obnovu.');
      }
      await load().catch(() => setNotice('Seznam přístupů se nepodařilo obnovit. Vydaný soukromý odkaz zůstává dostupný; seznam obnovte znovu.'));
    } catch { setNotice('Operaci se nepodařilo potvrdit. Obnovte seznam; vydání opakujte stejným tlačítkem. Nový klíč získáte výslovnou obnovou.'); await load().catch(() => undefined); }
    finally { setPending(false); }
  }
  async function copyLink() {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued.url); setNotice('Soukromý odkaz zkopírován. Předejte jej pouze tomuto rozhodčímu.'); }
    catch { linkField.current?.focus(); linkField.current?.select(); setNotice('Označený soukromý odkaz zkopírujte ručně (Ctrl+C nebo nabídka Kopírovat).'); }
  }
  return <section className="event-section" aria-label="Přístupy rozhodčích"><h2>Přístupy rozhodčích</h2><p>Kolegovi vydejte vlastní soukromý odkaz nebo QR. Otevře bodování této akce bez přihlášení.</p>
    <p>Pro kontrolu papírových archů mu předejte také klíč správných odpovědí z části Tisk a materiály. Odkaz rozhodčího obsahuje pouze týmy a body. Rozhodčí ukládá součet za kolo pro každý tým; výsledky na projektoru zveřejňuje moderátor.</p>
    {!canIssue && <p>Vydání a obnovení přístupu vyžaduje také oprávnění Zapisovat skóre.</p>}
    <div className="score-fields"><label className="form-field"><span>Označení rozhodčího</span><input maxLength={80} value={name} disabled={!canIssue || pending || !!issuance.current} onChange={e => setName(e.target.value)} /></label><label className="form-field"><span>Platnost přístupu do</span><input type="datetime-local" value={expires} disabled={!canIssue || pending || !!issuance.current} onChange={e => setExpires(e.target.value)} /></label></div>
    <div className="team-tool-actions"><button type="button" className="primary-button" disabled={!canIssue || pending || !name.trim()} onClick={() => void perform('issue')}>Vydat přístup rozhodčího</button><button type="button" className="secondary-button" disabled={pending} onClick={() => void load().catch(() => setNotice('Seznam nelze načíst.'))}>Obnovit seznam přístupů</button></div>
    {notice && <p role="status">{notice}</p>}
    {issued && <section className="qr-dialog" aria-label="Nový soukromý přístup"><h3>Soukromý QR rozhodčího</h3><p>Odkaz je zobrazen pouze nyní. Sdílejte jej jen s tímto rozhodčím. Po skrytí nebo obnovení stránky získáte nový odkaz tlačítkem Obnovit klíč; dosavadní odkaz tím přestane fungovat.</p>{issued.png && <img src={issued.png} alt="Soukromý QR rozhodčího" />}<label className="form-field"><span>Soukromý odkaz rozhodčího</span><input ref={linkField} readOnly value={issued.url} /></label><div className="team-tool-actions"><button type="button" className="secondary-button" onClick={() => void copyLink()}>Kopírovat soukromý odkaz</button>{issued.png && <a href={issued.png} download="rozhodci-soukromy-pristup.png" className="secondary-link">Stáhnout QR PNG</a>}<button type="button" className="secondary-button" onClick={() => setIssued(null)}>Skrýt soukromý odkaz</button></div></section>}
    <ul>{accesses.map(a => <li key={a.accessId}><strong>{a.label}</strong> · {new Date(a.expiresAt).toLocaleString('cs-CZ')} · {a.status === 'active' ? 'Platný' : a.status === 'expired' ? 'Vypršel' : 'Odebrán'}<div className="team-tool-actions"><button type="button" className="secondary-button" disabled={!canIssue || pending} onClick={() => void perform('rotate', a)}>Obnovit klíč — {a.label}</button><button type="button" className="danger-button" disabled={pending || a.status === 'revoked'} onClick={() => void perform('revoke', a)}>Odebrat — {a.label}</button></div></li>)}</ul>
  </section>;
}
