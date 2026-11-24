import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseServices } from '../../services/firebase/client';
import { useAuth } from '../../auth/AuthProvider';
import { eventActionError } from './eventApi';
import { getPublicEventResults } from './publicEventResults';
import type { EventRecord } from './types';

export function PublicEventResultsPublication({ event, onChanged }: { readonly event:EventRecord; readonly onChanged:(revision:number) => void }) {
  const { can } = useAuth();
  const [published, setPublished] = useState<boolean | null>(null), [confirm, setConfirm] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const busy = useRef(false);
  useEffect(() => {
    let active = true;
    setPublished(null); setConfirm(false); setError('');
    void getPublicEventResults(event.id).then(result => { if (active) setPublished(Boolean(result)); }).catch(() => { if (active) setError('Stav veřejných výsledků se nepodařilo načíst. Obnovte stránku.'); });
    return () => { active = false; };
  }, [event.id, event.revision]);
  if (!can('event.manage')) return null;
  const submit = async () => {
    if (busy.current || published === null) return;
    busy.current = true; setPending(true); setError('');
    try {
      const response = await httpsCallable<{ eventId:string; expectedRevision:number; published:boolean }, { revision:number; published:boolean }>(getFirebaseServices().functions, 'configurePublicEventResults')({ eventId:event.id, expectedRevision:event.revision, published:!published });
      setPublished(response.data.published); setConfirm(false); onChanged(response.data.revision);
    } catch (failure) { setError(eventActionError(failure)); }
    finally { busy.current = false; setPending(false); }
  };
  return <div className="public-results-publication">
    <p>Výsledky jsou nyní {published === null ? 'načítané' : published ? 'veřejné přes přímý odkaz' : 'neveřejné'}. Zveřejnění nezpřístupní ostatní archiv ani neotevře registrace.</p>
    {!confirm ? <button className="secondary-button" disabled={pending || published === null} onClick={() => setConfirm(true)}>{published ? 'Skrýt veřejné výsledky' : 'Zveřejnit konečné výsledky'}</button>
      : <div role="group" aria-label="Potvrzení zveřejnění výsledků"><p>{published ? 'Veřejný odkaz na tyto výsledky přestane fungovat.' : 'Výslovně zveřejňuji název, termín a místo akce a celé potvrzené konečné pořadí: názvy týmů, umístění a body. Detail bude dostupný komukoli s odkazem. Kontakty a údaje registrací zůstanou soukromé.'}</p><button className="primary-button" disabled={pending} onClick={() => void submit()}>{pending ? 'Ukládám…' : published ? 'Potvrdit skrytí výsledků' : 'Potvrdit zveřejnění výsledků'}</button><button className="secondary-button" disabled={pending} onClick={() => setConfirm(false)}>Zrušit</button></div>}
    {published && <p><Link to={`/events/${event.id}`}>Otevřít veřejné výsledky</Link></p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
