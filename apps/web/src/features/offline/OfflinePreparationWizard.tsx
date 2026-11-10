import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { offlineEventLimits, type OfflineEventPreflight, type OfflineIssue } from '@filmovy-kviz/quiz-domain';
import { OfflineNotebookStep, offlineTransferHref, useOfflineInstallPrompt } from './OfflineNotebookStep';
import { OfflinePreparationBlocked, OfflinePreparationIssues, prepareOfflineEvent, reusePreparedOfflineEvent,
  savePreparedOfflineEvent, verifySavedOfflineEvent, type PreparedOfflineEvent } from './offlinePreparation';
import { listOfflineSessions, type StoredOfflineSession } from './offlineStore';
import './offlineWizard.css';

const steps = ['Zkontrolovat kvíz', 'Vytvořit offline balíček', 'Připravit notebook'];
const date = new Intl.DateTimeFormat('cs', { dateStyle: 'medium', timeStyle: 'short' });
const storageMargin = 32 * 1024 * 1024 + offlineEventLimits.manifestBytes;
const mebibytes = (bytes: number) => Math.ceil(bytes / (1024 * 1024)).toLocaleString('cs');

type Step = 1 | 2 | 3;
type Problem = { text: string; action?: 'teams' | 'event' | 'login' | 'resume' | 'recheck' | 'replace' | 'install'; code?: string };

function preparationProblem(error: unknown, operation: 'check' | 'build' | 'reuse' | 'save' | 'verify'): Problem {
  if (error instanceof OfflinePreparationBlocked) {
    if (error.reason === 'played') return { text: 'Na tomto zařízení je už uložený průběh této akce. Pokračujte v uloženém kvízu nebo synchronizujte výsledky.', action: 'resume' };
    if (error.reason === 'expired') return { text: 'Platnost offline oprávnění vypršela. Zkontrolujte kvíz a připravte nový soubor.', action: operation === 'reuse' ? 'replace' : 'recheck' };
    return { text: 'Uložený balíček je zastaralý. Zkontrolujte uzamčený kvíz a připravte nový soubor.', action: operation === 'reuse' ? 'replace' : 'recheck' };
  }
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  const details = error && typeof error === 'object' && 'details' in error ? error.details : undefined;
  const check = details && typeof details === 'object' && 'offlineCheck' in details ? details.offlineCheck : undefined;
  const message = error instanceof Error ? error.message : '';
  if (check === 'teams') return { text: 'Kvíz potřebuje alespoň jeden potvrzený tým. Přidejte nebo potvrďte tým v administraci.', action: 'teams' };
  if (check === 'snapshot') return { text: 'Přiřaďte kvíz k akci a uzamkněte jeho připravenou verzi.', action: 'event' };
  if (code === 'functions/permission-denied') return { text: 'Váš účet už nemá oprávnění připravit tuto akci. Obraťte se na správce.', action: 'event', code };
  if (code === 'functions/unauthenticated' || message === 'Nejprve se online přihlaste do administrace JustKvízu.') return { text: 'Přihlaste se do administrace účtem, který může tuto akci moderovat a vyexportovat.', action: 'login' };
  if (code === 'functions/aborted' || code === 'functions/already-exists' || code === 'functions/failed-precondition') {
    if (operation === 'check') return { text: 'Akci teď nelze připravit offline. Zkontrolujte, že je aktivní, má uzamčený kvíz a že je offline režim dostupný.', action: 'event', code };
    return { text: 'Platnost balíčku se nepodařilo potvrdit. Kvíz, média nebo oprávnění se mohly změnit.', action: operation === 'reuse' ? 'replace' : 'recheck', code };
  }
  if (code === 'functions/resource-exhausted') return { text: 'Akce překračuje limit offline přípravy. Zkontrolujte počet týmů, kol a otázek.', action: 'event', code };
  if ((error instanceof DOMException && error.name === 'QuotaExceededError') || message.startsWith('Pro offline soubor není dostatek')) return { text: 'Pro uložení není dostatek místa. Uvolněte místo na zařízení a zkuste to znovu.' };
  if (error instanceof DOMException && error.name === 'AbortError') return { text: 'Ukládání bylo zrušeno. Zkuste soubor uložit znovu.' };
  if (operation === 'reuse' && message.startsWith('Nesprávné heslo')) return { text: 'Heslo neotevřelo uložený soubor. Zkontrolujte heslo a zkuste to znovu.', action: 'replace' };
  if (operation === 'verify') return { text: 'Vybraný soubor je poškozený nebo patří k jiné přípravě. Vyberte správný soubor nebo jej stáhněte znovu.' };
  if (operation === 'save') return { text: 'Soubor se nepodařilo uložit a ověřit. Zkuste jiné umístění nebo použijte stažení.' };
  if (message.startsWith('Aplikaci se nepodařilo uložit') || message.startsWith('Offline aplikace se bez síťového')) return {
    text: 'JustKvíz se nepodařilo připravit ke spuštění bez internetu. Zkontrolujte připojení a nastavení Chrome a zkuste to znovu.', action: 'install',
  };
  if (message.includes('trvalé úložiště') || message.includes('podporovaný Chrome')) return {
    text: 'Chrome potřebuje povolit uchování offline dat. Použijte běžné okno Chrome. Pokud je dostupná instalace JustKvízu, nainstalujte ho a zkuste přípravu znovu.', action: 'install',
  };
  const slide = /^Snímek (\d{1,4})/u.exec(message)?.[1];
  if (slide) return { text: 'Snímek ' + slide + ': obrázek nebo ukázku se nepodařilo stáhnout či přehrát. Zkuste to znovu nebo nahraďte soubor.', action: 'event' };
  return { text: 'Operaci se nepodařilo dokončit. Zkontrolujte připojení a zkuste to znovu.' };
}

function Issues({ issues }: { issues: readonly OfflineIssue[] }) {
  return <ul className="offline-wizard-issues">{issues.map((issue, index) => <li key={index}>
    {issue.slidePosition > 0 && <strong>Snímek {issue.slidePosition}. </strong>}{issue.message}
  </li>)}</ul>;
}

export function OfflinePreparationWizard({ eventId, transferTarget }: { eventId: string; transferTarget: boolean }) {
  const installation = useOfflineInstallPrompt();
  const [step, setStep] = useState<Step>(1);
  const [check, setCheck] = useState<OfflineEventPreflight | null>(null);
  const [candidate, setCandidate] = useState<StoredOfflineSession | undefined>();
  const [prepared, setPrepared] = useState<PreparedOfflineEvent | null>(null);
  const [saved, setSaved] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);
  const [authorityCurrent, setAuthorityCurrent] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [formError, setFormError] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [issues, setIssues] = useState<readonly OfflineIssue[]>([]);
  const [progress, setProgress] = useState('');
  const [media, setMedia] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const running = useRef(false);
  const epoch = useRef(0);
  const building = useRef<AbortController | null>(null);
  const request = useRef<{ id: string; snapshotId: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const confirmationInput = useRef<HTMLInputElement>(null);
  const eventLink = '/admin/events/' + encodeURIComponent(eventId);
  const eventImport = '/offline.html#/import?eventId=' + encodeURIComponent(eventId);

  const go = (next: Step) => {
    setStep(next);
    window.requestAnimationFrame(() => heading.current?.focus());
  };
  const run = useCallback(async (operation: Parameters<typeof preparationProblem>[1], work: (isCurrent: () => boolean) => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    const generation = epoch.current;
    const isCurrent = () => epoch.current === generation;
    setBusy(true);
    setProblem(null);
    setIssues([]);
    try { await work(isCurrent); }
    catch (error) {
      if (!isCurrent()) return;
      if (error instanceof OfflinePreparationIssues) setIssues(error.issues);
      else setProblem(preparationProblem(error, operation));
    } finally {
      running.current = false;
      setBusy(false);
      setProgress('');
      setMedia(null);
    }
  }, []);

  const inspect = useCallback(() => run('check', async isCurrent => {
    setCheck(null);
    setCandidate(undefined);
    setProgress('Kontroluji akci, týmy a média…');
    if (!/^[A-Za-z0-9_-]{1,150}$/u.test(eventId)) {
      setProblem({ text: 'Otevřete přípravu offline kvízu z detailu uzamčené akce.' });
      return;
    }
    const { checkOnlineOfflineEvent } = await import('./offlineOnline');
    const result = await checkOnlineOfflineEvent(eventId);
    if (!isCurrent()) return;
    setCheck(result);
    if (result.issues.length) {
      setIssues(result.issues);
      return;
    }
    if (Date.now() >= result.expiresAtMs) throw new OfflinePreparationBlocked('expired');
    if (!window.isSecureContext || !navigator.storage?.persist || !navigator.locks || !navigator.serviceWorker) {
      setProblem({ text: 'Pro přípravu použijte běžné okno Google Chrome na notebooku.' });
      return;
    }
    const [sessions, storage] = await Promise.all([listOfflineSessions(), navigator.storage.estimate()]);
    if (!isCurrent()) return;
    const local = sessions.filter(session => session.eventId === eventId);
    if (local.some(session => session.sequence > 0)) throw new OfflinePreparationBlocked('played');
    if (storage.quota === undefined || storage.quota - (storage.usage ?? 0) < (local.length ? 16 * 1024 * 1024 : result.mediaBytes + storageMargin)) {
      setProblem({ text: 'Pro offline kvíz není v prohlížeči dost místa. Uvolněte místo a spusťte kontrolu znovu.' });
      return;
    }
    setCandidate(local.at(-1));
  }), [eventId, run]);

  useEffect(() => {
    if (transferTarget) return;
    let unsubscribe: (() => void) | undefined;
    let active = true;
    void import('./offlineOnline').then(({ observeOfflineIdentity }) => {
      if (!active) return;
      unsubscribe = observeOfflineIdentity(() => {
        ++epoch.current;
        building.current?.abort();
        request.current = null;
        setPrepared(null); setSaved(false); setAuthorityCurrent(false); setCheck(null); setValidating(false); setDeviceReady(false);
        setPassword(''); setConfirmation(''); setStep(1);
        setProblem({ text: 'Přihlášení se změnilo. Zkontrolujte kvíz znovu.', action: 'recheck' });
      });
    }).catch(() => {}).finally(() => { if (active) void inspect(); });
    return () => { active = false; ++epoch.current; building.current?.abort(); unsubscribe?.(); };
  }, [inspect, transferTarget]);

  useEffect(() => {
    if (!prepared) return;
    let active = true;
    let inFlight = false;
    const expire = () => {
      setAuthorityCurrent(false);
      setDeviceReady(false);
      setProblem(preparationProblem(new OfflinePreparationBlocked('expired'), 'save'));
    };
    const timer = window.setTimeout(expire, Math.max(0, prepared.expiresAtMs - Date.now()));
    const verify = () => {
      if (!navigator.onLine || running.current || inFlight) return;
      inFlight = true;
      setValidating(true);
      setAuthorityCurrent(false);
      setDeviceReady(false);
      void prepared.revalidate().then(() => { if (active) { setAuthorityCurrent(true); setProblem(null); } }).catch(error => {
        if (active) setProblem(preparationProblem(error, 'save'));
      }).finally(() => { inFlight = false; if (active) setValidating(false); });
    };
    window.addEventListener('focus', verify);
    window.addEventListener('online', verify);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener('focus', verify);
      window.removeEventListener('online', verify);
    };
  }, [prepared]);

  const reset = () => {
    setPrepared(null); setSaved(false); setDownloaded(false); setAuthorityCurrent(false); setValidating(false); setDeviceReady(false);
    setPassword(''); setConfirmation(''); setVisible(false); setFormError('');
    request.current = null;
    go(1);
    void inspect();
  };

  const installPrompt = problem?.action === 'install' ? installation.prompt : null;
  const offerChromeInstall = () => {
    if (!installPrompt) return;
    installation.clear();
    void run('build', async () => { await installPrompt.prompt(); });
  };

  const build = (event: FormEvent) => {
    event.preventDefault();
    if (!check || busy) return;
    if (password.length < 10 || password.length > 200) {
      setFormError('Zadejte heslo o délce 10 až 200 znaků.'); passwordInput.current?.focus(); return;
    }
    if (!candidate && password !== confirmation) {
      setFormError('Hesla se neshodují. Zadejte stejné heslo do obou polí.'); confirmationInput.current?.focus(); return;
    }
    setFormError('');
    void run(candidate ? 'reuse' : 'build', async isCurrent => {
      if (Date.now() >= check.expiresAtMs) throw new OfflinePreparationBlocked('expired');
      if (request.current?.snapshotId !== check.snapshotId) request.current = { snapshotId: check.snapshotId, id: crypto.randomUUID() };
      const report = (done: number, total: number) => { if (isCurrent()) setMedia({ done, total }); };
      setProgress(candidate ? 'Ověřuji dříve připravený soubor a média…' : 'Připravuji kvíz…');
      const controller = new AbortController();
      building.current = controller;
      const result = await (candidate ? reusePreparedOfflineEvent(candidate, check.snapshotId, password, report)
        : prepareOfflineEvent(eventId, check.snapshotId, request.current.id, password,
          text => { if (isCurrent()) setProgress(text); }, report, controller.signal)).finally(() => { building.current = null; });
      if (!isCurrent()) return;
      setPrepared(result); setAuthorityCurrent(true);
      setPassword(''); setConfirmation(''); setVisible(false);
    });
  };

  const save = (download = false) => {
    if (!prepared) return;
    void run('save', async isCurrent => {
      setProgress('Ukládám a ověřuji soubor…');
      const confirmed = await savePreparedOfflineEvent(prepared, download);
      if (!isCurrent()) return;
      if (confirmed) { setSaved(true); setAuthorityCurrent(true); go(3); }
      else setDownloaded(true);
    });
  };

  const verifyFile = (file: File) => {
    if (!prepared) return;
    void run('verify', async isCurrent => {
      setProgress('Čtu uložený soubor a ověřuji, že je úplný…');
      await verifySavedOfflineEvent(prepared, file);
      try { await prepared.revalidate(); }
      catch (error) {
        if (isCurrent()) setProblem(preparationProblem(error, 'save'));
        return;
      }
      if (!isCurrent()) return;
      setSaved(true); setAuthorityCurrent(true); go(3);
    });
  };

  const openPrepared = () => {
    if (!prepared || !saved || !authorityCurrent) return;
    void run('save', async isCurrent => {
      try {
        if (Date.now() >= prepared.expiresAtMs) throw new OfflinePreparationBlocked('expired');
        if (navigator.onLine) await prepared.revalidate();
      } catch (error) {
        if (isCurrent()) { setAuthorityCurrent(false); setDeviceReady(false); }
        throw error;
      }
      if (isCurrent()) window.location.assign(eventImport);
    });
  };

  const showProblem = problem && <div className="offline-wizard-problem" role="alert">
    <strong>{problem.action === 'resume' ? 'Tento kvíz už je rozehraný' : 'Je potřeba něco opravit'}</strong><p>{problem.text}</p>
  </div>;
  const problemLink = problem?.action === 'teams' ? { href: eventLink + '/registrations', title: 'Spravovat týmy' }
    : problem?.action === 'event' ? { href: eventLink, title: 'Otevřít detail akce' }
    : problem?.action === 'login' ? { href: '/admin', title: 'Přejít k přihlášení' }
    : problem?.action === 'resume' ? { href: eventImport, title: 'Pokračovat v uloženém kvízu' } : null;

  return <div className="offline-wizard">
    <div className="offline-wizard-intro">
      <p className="eyebrow">JustKvíz · Hraní bez internetu</p>
      <h1>{transferTarget ? 'Připravit cílový notebook' : 'Připravit offline kvíz'}</h1>
      <p>{transferTarget ? 'Ověřte zařízení, na kterém budete kvíz moderovat.' : 'Připravte si celý kvízový večer, i když na místě nebude internet.'}</p>
    </div>
    {transferTarget ? <OfflineNotebookStep eventId={eventId} transferTarget installation={installation} /> : <>
      <ol className="offline-wizard-steps" aria-label="Postup přípravy">
        {steps.map((title, index) => <li key={title} aria-current={index + 1 === step ? 'step' : undefined} data-done={index + 1 < step || (index === 2 && deviceReady && authorityCurrent)}>
          <span aria-hidden="true">{index + 1 < step || (index === 2 && deviceReady && authorityCurrent) ? '✓' : index + 1}</span><b>{title}</b>
        </li>)}
      </ol>
      <section className="offline-wizard-card" aria-labelledby="offline-wizard-step" data-offline-wizard-step={step} aria-busy={busy}>
        <p className="offline-wizard-kicker">Krok {step} ze 3</p>
        <h2 id="offline-wizard-step" ref={heading} tabIndex={-1}>{steps[step - 1]}</h2>
        {progress && <p className="offline-wizard-progress" role="status">{progress}{media && <> Hotovo {media.done} z {media.total} médií.</>}</p>}
        {showProblem}
        {issues.length > 0 && <div className="offline-wizard-problem" role="alert"><strong>Je potřeba něco opravit</strong><Issues issues={issues} /></div>}
        {step === 1 && <>
          {!busy && check && !problem && issues.length === 0 && <div className="offline-wizard-success" role="status">
            <strong>Kvíz lze připravit</strong>
            <p>Uzamčený kvíz, oprávnění, týmy, dostupnost médií a místo v prohlížeči jsou ověřené.</p>
            <dl><div><dt>Potvrzené týmy</dt><dd>{check.teamCount}</dd></div><div><dt>Obrázky a ukázky</dt><dd>{check.mediaCount}</dd></div><div><dt>Předběžná platnost do</dt><dd>{date.format(check.expiresAtMs)}</dd></div></dl>
          </div>}
          <div className="offline-wizard-actions">
            {!busy && (problemLink ? <a className="offline-wizard-primary" href={problemLink.href}>{problemLink.title}</a>
              : check && !problem && issues.length === 0 ? <button className="offline-wizard-primary" onClick={() => go(2)}>Pokračovat k balíčku</button>
              : <button className="offline-wizard-primary" onClick={() => void inspect()}>Zkontrolovat znovu</button>)}
            {!busy && problemLink && <button className="offline-wizard-secondary" onClick={() => void inspect()}>Zkontrolovat znovu</button>}
            {!busy && issues.length > 0 && <a href={eventLink}>Otevřít detail akce</a>}
            {!busy && <a href={offlineTransferHref(eventId)}>Už mám soubor z jiného počítače</a>}
          </div>
        </>}
        {step === 2 && (!prepared ? <>
          <p>{candidate ? 'Můžete ověřit dříve připravený soubor a uložit jeho novou kopii.' : 'Nastavte heslo k šifrovanému souboru. Bez něj kvíz neotevřete.'}</p>
          <form onSubmit={build} noValidate>
            <div className="offline-wizard-password">
              <label htmlFor="offline-wizard-password">{candidate ? 'Heslo k uloženému souboru' : 'Heslo offline souboru'}</label>
              <div><input id="offline-wizard-password" ref={passwordInput} type={visible ? 'text' : 'password'} autoComplete={candidate ? 'current-password' : 'new-password'} value={password}
                minLength={10} maxLength={200} required disabled={busy} aria-describedby={formError ? 'offline-wizard-form-error' : undefined}
                onChange={event => { setPassword(event.target.value); setFormError(''); }} />
                <button className="offline-wizard-secondary" type="button" aria-controls="offline-wizard-password" onClick={() => setVisible(value => !value)}>{visible ? 'Skrýt heslo' : 'Zobrazit heslo'}</button>
              </div>
              {!candidate && <><label htmlFor="offline-wizard-confirmation">Heslo znovu</label>
                <input id="offline-wizard-confirmation" ref={confirmationInput} type={visible ? 'text' : 'password'} autoComplete="new-password" value={confirmation}
                  minLength={10} maxLength={200} required disabled={busy} aria-invalid={formError !== '' && password !== confirmation}
                  aria-describedby={formError ? 'offline-wizard-form-error' : undefined}
                  onChange={event => { setConfirmation(event.target.value); setFormError(''); }} /></>}
              {formError && <p id="offline-wizard-form-error" className="offline-wizard-form-error" role="alert">{formError}</p>}
            </div>
            <div className="offline-wizard-actions">
              {installPrompt ? <button type="button" className="offline-wizard-primary" onClick={offerChromeInstall}>Nainstalovat JustKvíz v Chrome</button>
                : problem?.action === 'recheck' ? <button type="button" className="offline-wizard-primary" onClick={reset}>Zkontrolovat kvíz znovu</button>
                : problemLink && problem?.action !== 'event' ? <a className="offline-wizard-primary" href={problemLink.href}>{problemLink.title}</a>
                : <button className="offline-wizard-primary" disabled={busy}>{candidate ? 'Ověřit uložený balíček' : 'Vytvořit offline balíček'}</button>}
              {candidate && problem?.action === 'replace' && <button type="button" className="offline-wizard-secondary" disabled={busy} onClick={() => {
                setCandidate(undefined); request.current = null; setPassword(''); setProblem(null); setFormError(''); passwordInput.current?.focus();
              }}>Nastavit nové heslo a vytvořit nový soubor</button>}
              {problemLink && problem?.action === 'event' && <a href={problemLink.href}>{problemLink.title}</a>}
              <button type="button" className="offline-wizard-secondary" disabled={busy} onClick={reset}>Zpět ke kontrole</button>
            </div>
          </form>
        </> : <>
          <p><strong>{downloaded ? 'Stažení bylo zahájeno' : 'Balíček je vytvořený'}</strong></p>
          <p>{downloaded ? 'Vyberte stažený soubor. Ověříme, že se uložil celý a že jde o tento kvíz.' : 'Uložte soubor do složky, kde jej před akcí najdete. JustKvíz uloženou kopii znovu přečte a ověří.'}</p>
          <div className="offline-wizard-actions">
            {problem?.action === 'recheck' ? <button className="offline-wizard-primary" onClick={reset}>Zkontrolovat kvíz znovu</button>
              : problemLink ? <a className="offline-wizard-primary" href={problemLink.href}>{problemLink.title}</a>
              : downloaded ? <label className="offline-wizard-primary offline-wizard-file">
                Ověřit stažený soubor<input type="file" accept=".justkvizoffline" disabled={busy} onChange={event => {
                  const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) verifyFile(file);
                }} />
              </label> : <button className="offline-wizard-primary" disabled={busy} onClick={() => save()}>Uložit offline soubor</button>}
            {problem?.action !== 'recheck' && !problemLink && (downloaded || problem) &&
              <button className="offline-wizard-secondary" disabled={busy} onClick={() => save(true)}>{downloaded ? 'Stáhnout znovu' : 'Stáhnout soubor'}</button>}
          </div>
        </>)}
        {step === 3 && <>
          {saved && <p className="offline-wizard-file-saved"><span aria-hidden="true">✓</span> Offline soubor je uložený a ověřený.</p>}
          {validating && <p role="status">Ověřuji, zda je balíček stále platný…</p>}
          {prepared && authorityCurrent && !validating && <OfflineNotebookStep eventId={eventId} packageVerified={saved}
            installation={installation} onReady={setDeviceReady} onOpen={openPrepared} opening={busy} />}
          {!authorityCurrent && !validating && <div className="offline-wizard-actions">
            {problemLink ? <a className="offline-wizard-primary" href={problemLink.href}>{problemLink.title}</a>
              : <button className="offline-wizard-primary" onClick={reset}>Zkontrolovat kvíz znovu</button>}
          </div>}
        </>}
      </section>
      <details className="offline-wizard-details"><summary>Technické podrobnosti</summary>
        <p>Formát souboru: .justkvizoffline. Balíček obsahuje šifrované odpovědi a poznámky. Uchovávejte heslo odděleně od souboru.</p>
        {check && <p>Velikost médií: {mebibytes(check.mediaBytes)} MiB. Volné místo je odhad pro toto úložiště prohlížeče.</p>}
        {prepared && <p>Platnost offline oprávnění do {date.format(prepared.expiresAtMs)}.</p>}
        {problem?.code && <p>Stav ověření: {problem.code}.</p>}
      </details>
    </>}
  </div>;
}
