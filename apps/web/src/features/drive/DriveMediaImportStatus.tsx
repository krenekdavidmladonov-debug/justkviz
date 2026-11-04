import type { EditorSlide } from '../editor/types';
import type { DriveImportField } from './importsApi';
import { driveImportFingerprint, type DriveMediaImportEntry } from './useDriveMediaImports';

const labels: Record<DriveImportField, string> = { mediaSource: 'Ukázka', questionImage: 'Obrázek otázky', answerImage: 'Obrázek odpovědi', backgroundImage: 'Pozadí' };
export function DriveMediaImportStatus({ slide, entries, dirty, onRetry }: {
  readonly slide: EditorSlide; readonly entries: readonly DriveMediaImportEntry[]; readonly dirty: boolean;
  readonly onRetry: (field: DriveImportField) => void;
}) {
  const selected = entries.filter(entry => entry.slideId === slide.id && entry.field === 'mediaSource');
  if (!selected.length) return null;
  return <div className="field-help" aria-label="Uložení médií na Google Disk">
    {selected.map(entry => {
      const changed = entry.fingerprint !== driveImportFingerprint(slide, entry.field) && !(entry.status === 'ready' && entry.reference === slide[entry.field]);
      const failed = entry.status === 'failed' || entry.status === 'stale';
      const waiting = entry.execution === 'local' && !failed && entry.status !== 'ready';
      return <p key={entry.field} role="status"><strong>{labels[entry.field]}: </strong>
        {changed ? 'Nová verze se uloží na Disk po uložení změn.' : entry.status === 'ready' ? 'Uloženo na Disk.' : failed ? 'Nepodařilo se uložit na Disk.' : waiting ? entry.status === 'queued' ? 'Čeká na počítač.' : 'Připravuje se na počítači…' : 'Ukládám na Disk…'}
        {!changed && waiting && entry.pollingPaused && <>{' '}Spusťte Windows pomocníka a obnovte stav.{' '}<button type="button" className="text-button" disabled={dirty} onClick={() => onRetry(entry.field)}>Obnovit stav</button></>}
        {!changed && failed && <>{' '}<button type="button" className="text-button" disabled={dirty} onClick={() => onRetry(entry.field)}>Zkusit znovu</button></>}
      </p>;
    })}
    {selected.some(entry => entry.field === 'mediaSource') && <p>Na Disk se ukládá jen zvolený úsek, nejvýše 3 minuty; stejná ukázka se použije při rekapitulaci.</p>}
  </div>;
}
