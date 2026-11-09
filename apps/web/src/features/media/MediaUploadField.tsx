import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { isSafeHttpUrl, parseQuizAsset, directMediaKind, youtubeVideoId, type OwnedMediaKind } from '@filmovy-kviz/quiz-domain';
import { uploadQuizMedia, listQuizMedia } from './mediaApi';
import { AssetImage } from './AssetImage';

export const MediaAuthoringContext = createContext<{ quizId: string; onPending: (pending: boolean) => void; canUpload?: boolean; canAttach?: boolean } | null>(null);

/** One picker for prompt, answer and background. Only ready references enter the draft. */
export function MediaUploadField({ kind, label, value, disabled: disabledProp, onReady }: {
  kind: OwnedMediaKind; label: string; value: string; disabled: boolean; onReady: (reference: string) => void;
}) {
  const context = useContext(MediaAuthoringContext);
  const disabled = disabledProp || context?.canAttach === false;
  const acceptedFileTypes = kind === 'image' ? 'image/png,image/jpeg,image/webp'
    : kind === 'audio' ? 'audio/mpeg,audio/wav,audio/x-wav,.wav' : 'video/mp4,.mp4';
  const [mode, setMode] = useState<'closed' | 'url' | 'library' | 'file'>('closed');
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof listQuizMedia>>>([]);
  const [listing, setListing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), lastFile = useRef<File | null>(null);
  const controller = useRef<AbortController | null>(null), epoch = useRef(0);
  const callback = useRef(onReady), pendingCallback = useRef(context?.onPending);
  useEffect(() => { callback.current = onReady; pendingCallback.current = context?.onPending; });
  useEffect(() => () => { epoch.current++; controller.current?.abort(); pendingCallback.current?.(false); }, []);
  const cancel = () => { epoch.current++; controller.current?.abort(); controller.current = null; setPending(false); pendingCallback.current?.(false); setError('Nahrávání bylo zrušeno. Rozepsaný obsah zůstal zachovaný.'); };
  const assign = (reference: string) => { epoch.current++; controller.current?.abort(); setError(''); setMode('closed'); callback.current(reference); };
  const upload = async (file: File) => {
    if (!context || context.canUpload === false || disabled) return;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const run = ++epoch.current; lastFile.current = file; setPending(true); setProgress(0); setError(''); pendingCallback.current?.(true);
    try {
      const reference = await uploadQuizMedia(context.quizId, kind, file, { signal: abort.signal, onProgress: setProgress });
      if (run !== epoch.current || abort.signal.aborted) return;
      callback.current(reference); setMode('closed');
    } catch (failure) {
      if (run === epoch.current) setError(failure instanceof Error ? failure.message : 'Médium se nepodařilo připravit. Zkuste nahrávání znovu.');
    } finally {
      if (run === epoch.current) { setPending(false); pendingCallback.current?.(false); controller.current = null; }
    }
  };
  const library = async () => {
    if (!context) return;
    const run = ++epoch.current; setMode('library'); setListing(true); setError('');
    try { const items = await listQuizMedia(context.quizId, kind); if (run === epoch.current) setAssets(items); }
    catch { if (run === epoch.current) setError('Média kvízu se nepodařilo načíst. Zkuste výběr znovu.'); }
    finally { if (run === epoch.current) setListing(false); }
  };
  const applyUrl = () => {
    const next = url.trim();
    const valid = kind === 'image' ? isSafeHttpUrl(next) : youtubeVideoId(next) !== undefined || directMediaKind(next) === kind;
    if (!valid) { setError(kind === 'image' ? 'Vložte HTTP(S) odkaz na obrázek.' : 'Vložte YouTube odkaz nebo přímý odkaz na podporovaný audio/video soubor.'); return; }
    assign(next);
  };
  return <section className="media-picker" aria-label={label}>
    <h3>{label}</h3>
    {value && kind === 'image' && <div className="media-picker-preview"><AssetImage source={value} alt={label} /></div>}
    {value && <p className="field-help">{parseQuizAsset(value) ? 'Ověřené médium tohoto kvízu' : 'Odkaz na médium'} · přiřazení potvrďte tlačítkem Uložit.</p>}
    <div className="media-picker-actions">
      {value && <><button type="button" className="secondary-button" disabled={disabled || pending} onClick={() => { setUrl(parseQuizAsset(value) ? '' : value); setMode('url'); }}>Změnit</button><button type="button" className="secondary-button" disabled={disabled || pending} onClick={() => assign('')}>Odebrat</button></>}
      <button type="button" className="secondary-button" disabled={disabled || pending || !context || context.canUpload === false} onClick={() => { setMode('file'); fileInput.current?.click(); }}>Nahrát z počítače</button>
      <button type="button" className="secondary-button" disabled={disabled || pending} onClick={() => { setUrl(parseQuizAsset(value) ? '' : value); setMode('url'); setError(''); }}>Vložit odkaz</button>
      <button type="button" className="secondary-button" disabled={disabled || pending || !context} onClick={() => void library()}>Vybrat z médií tohoto kvízu</button>
    </div>
    <input ref={fileInput} type="file" hidden aria-label={label + ' — soubor'} accept={acceptedFileTypes} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
    {mode === 'url' && <div className="media-url-entry"><label>Odkaz na médium<input aria-label={label + ' — odkaz'} value={url} onChange={event => setUrl(event.target.value)} disabled={disabled || pending} placeholder="https://…" /></label><button type="button" className="secondary-button" disabled={disabled || pending} onClick={applyUrl}>Použít odkaz</button></div>}
    {mode === 'library' && <div className="media-library">{listing ? <p role="status">Načítám média…</p> : assets.length === 0 ? <p>Zatím zde nejsou ověřená média tohoto typu.</p> : assets.map((asset, index) => <button type="button" className="secondary-button" key={asset.reference} disabled={disabled || pending} onClick={() => assign(asset.reference)}>{kind === 'image' && <AssetImage source={asset.reference} alt={'Médium ' + (index + 1)} />}Vybrat médium {index + 1} · {Math.ceil(asset.size / 1024)} KiB</button>)}</div>}
    {pending && <div role="status"><progress max="100" value={progress} aria-label="Průběh nahrávání" /><p>{progress < 100 ? `Nahrávám ${progress} %` : 'Přenos dokončen. Ověřuji soubor…'}</p><button type="button" className="secondary-button" onClick={cancel}>Zrušit nahrávání</button></div>}
    {error && <p role="alert">{error}</p>}
    {!pending && error && lastFile.current && <button type="button" className="secondary-button" disabled={disabled} onClick={() => { if (lastFile.current) void upload(lastFile.current); }}>Zkusit nahrát znovu</button>}
    <small>{kind === 'image' ? 'PNG, JPEG, WebP do 10 MiB.' : kind === 'audio' ? 'MP3/WAV do 25 MiB nebo přímý audio/YouTube odkaz.' : 'Vlastní MP4 do 25 MiB. Pro přehrávání online lze vložit i odkaz.'}</small>
  </section>;
}
