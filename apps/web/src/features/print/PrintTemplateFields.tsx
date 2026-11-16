import { useState } from 'react';
import type { PrintTemplate } from '@filmovy-kviz/quiz-domain';
import '../../styles/print.css';
import '../../styles/print-editor-simple.css';

export interface PrintTemplateFieldsProps {
  value: PrintTemplate;
  disabled: boolean;
  onChange: (value: PrintTemplate) => void;
  quizId?: string;
}

const previews = [
  { id: 'player', label: 'Hráčský arch' },
  { id: 'organizer', label: 'Správné odpovědi' },
  { id: 'score', label: 'Bodovací tabulka' },
] as const;

export function PrintTemplateFields({ value, disabled, onChange }: PrintTemplateFieldsProps) {
  const [preview, setPreview] = useState<(typeof previews)[number]['id']>('player');
  const layout = value.layout ?? 'comfortable';
  const image = preview === 'player' ? `player-${layout === 'compact' ? 'compact' : 'standard'}` : preview;
  const label = previews.find(item => item.id === preview)!.label;

  return <section className="print-template-settings print-editor-simple" aria-label="Vzhled tiskových archů">
    <h3>Vzhled tisku</h3>
    <label className="form-field"><span>Šablona odpovědních archů</span>
      <select value={layout} disabled={disabled} onChange={event => onChange({ ...value, layout: event.target.value as 'comfortable' | 'compact' })}>
        <option value="comfortable">Standardní — pohodlný prostor pro psaní</option>
        <option value="compact">Úsporný — méně stránek</option>
      </select>
    </label>
    <div className="print-editor-preview-options" role="group" aria-label="Ukázka tiskového dokumentu">
      {previews.map(item => <button key={item.id} type="button" aria-pressed={preview === item.id} onClick={() => setPreview(item.id)}>{item.label}</button>)}
    </div>
    <figure className="print-editor-preview">
      <figcaption><strong>{label}</strong><span>Ukázka vzhledu — vzorová data · <a href={`/print-samples/${image}.png?brand=jk-v1`} target="_blank" rel="noopener noreferrer">Zvětšit ukázku</a></span></figcaption>
      <img src={`/print-samples/${image}.png?brand=jk-v1`} alt={`${label} — ukázka vzhledu se vzorovými daty`} />
    </figure>
    <p className="field-help">PDF vašeho kvízu vytvoříte z připravené akce. <a href="/admin/events">Otevřít akce a tiskové centrum</a></p>
    <p className="field-help">Již připravená akce převezme změnu vzhledu až po novém připravení kvízu.</p>
  </section>;
}
