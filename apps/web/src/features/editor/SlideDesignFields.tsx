import type { SlideDesign } from '@filmovy-kviz/quiz-domain';
import { MediaUploadField } from '../media/MediaUploadField';
import { colorInputValue, rendererDefaults } from '../presentation/design';
import type { EditorSlide } from './types';

export const designDefaults: Required<SlideDesign> = {
  ...rendererDefaults, backgroundImage: '', logoImage: '',
};

export function legacySlideDesign(slide: EditorSlide): SlideDesign {
  const overlay = slide.backgroundOverlay ?? slide.presentation.backgroundOverlay;
  return { ...(slide.backgroundImage ? { backgroundImage: slide.backgroundImage } : {}), ...(overlay === null ? {} : { backgroundOverlay: Math.max(0, Math.min(100, overlay)) }), ...(['image', 'picture', 'photo', 'audio', 'music'].includes(slide.kind) ? { layout: 'split' as const } : {}) };
}

const presets: { label: string; design: SlideDesign }[] = [
  { label: 'JustKvíz · klasika', design: { backgroundColor: '#101722', textColor: '#fbf8f0', accentColor: '#f3b33d', layout: 'classic', fontFamily: 'sans', textAlign: 'left' } },
  { label: 'Slavnostní střed', design: { backgroundColor: '#182236', textColor: '#ffffff', accentColor: '#e6bb75', layout: 'centered', fontFamily: 'display', textAlign: 'center' } },
  { label: 'Obraz vedle textu', design: { layout: 'split', textWidth: 45, mediaFit: 'contain', textAlign: 'left' } },
  { label: 'Obraz v hlavní roli', design: { layout: 'image-first', textWidth: 35, mediaFit: 'cover', textAlign: 'left' } },
];
const layoutFields = ['layout', 'textAlign', 'textWidth', 'mediaFit'];

function luminance(hex: string) {
  if (hex.length === 4) hex = '#' + hex.slice(1).split('').map(value => value + value).join('');
  const parts = hex.replace('#', '').match(/.{2}/g)?.map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  }) ?? [0, 0, 0];
  return parts[0]! * .2126 + parts[1]! * .7152 + parts[2]! * .0722;
}

export function designContrastWarning(design: SlideDesign) {
  const bg = luminance(design.backgroundColor ?? designDefaults.backgroundColor);
  const text = luminance(design.textColor ?? designDefaults.textColor);
  return (Math.max(bg, text) + .05) / (Math.min(bg, text) + .05) < 4.5;
}

/** Every change writes only the selected override; inherited values remain live. */
export function SlideDesignFields({ value, inherited = {}, legacy = {}, legacyResetAvailable, disabled, lockLayout = false, scope, onChange, onReset }: {
  readonly value: SlideDesign;
  readonly inherited?: SlideDesign;
  readonly legacy?: SlideDesign;
  readonly legacyResetAvailable?: boolean;
  readonly disabled: boolean;
  readonly lockLayout?: boolean;
  readonly scope: 'quiz' | 'round' | 'slide' | 'answer' | 'results';
  readonly onChange: (value: SlideDesign) => void;
  readonly onReset?: () => void;
}) {
  const effective = { ...designDefaults, ...legacy, ...inherited, ...value };
  const presetChoices = scope === 'results' ? presets.filter(preset => preset.design.layout !== 'image-first') : presets;
  const editableFields = (key: string) => !lockLayout || !layoutFields.includes(key);
  const availablePresets = presetChoices.map(preset => ({
    label: preset.label, design: Object.fromEntries(Object.entries(preset.design).filter(([key]) => editableFields(key))),
  })).filter(preset => Object.keys(preset.design).length > 0);
  const local = Object.keys(value).length;
  const legacyOverride = legacyResetAvailable ?? (Boolean(legacy.backgroundImage) || (legacy.backgroundOverlay ?? 0) > 0);
  const set = <K extends keyof SlideDesign>(key: K, next: SlideDesign[K]) => onChange({ ...value, [key]: next });
  const origin = (key: keyof SlideDesign) => Object.hasOwn(value, key) ? 'Vlastní' : scope === 'quiz' ? 'Výchozí' : Object.hasOwn(inherited, key) ? 'Děděné' : Object.hasOwn(legacy, key) ? 'Uložené' : 'Výchozí';
  return <section className="slide-design-editor" aria-label="Vzhled slidu">
    <div className="design-inheritance"><strong>{scope === 'quiz' ? 'Společný vzhled celého kvízu' : scope === 'round' ? 'Vzhled kola → dědí otázky a rekapitulace' : scope === 'answer' ? 'Pouze odhalená odpověď' : 'Vzhled tohoto slidu'}</strong>
      <p>{scope === 'quiz' ? 'Změna se promítne do děděných hodnot všech slidů. Vlastní úpravy zůstanou zachované.' : `Kvíz → kolo → slide${scope === 'answer' ? ' → odpověď' : ''}. ${local ? `${local} vlastních nastavení.` : 'Vše se dědí.'}`}</p>
      <button type="button" className="secondary-button" disabled={disabled || (!local && !legacyOverride)} onClick={() => onReset ? onReset() : onChange({})}>Obnovit výchozí vzhled</button>
    </div>
    <label className="form-field">Šablona<select disabled={disabled} value="" onChange={event => { const preset = availablePresets[Number(event.target.value)]; if (preset) onChange({ ...value, ...preset.design }); }}><option value="">Vyberte vhodnou kompozici…</option>{availablePresets.map((preset, i) => <option key={preset.label} value={i}>{preset.label}</option>)}</select></label>
    <div className="design-colors">{(['backgroundColor', 'textColor', 'accentColor'] as const).map((key, index) => <label className="form-field" key={key}>{['Barva pozadí', 'Barva textu', 'Barva zvýraznění'][index]}<small>{origin(key)}</small><input type="color" disabled={disabled} value={colorInputValue(effective[key])} onChange={event => set(key, event.target.value)} /></label>)}</div>
    <MediaUploadField kind="image" label={`Pozadí${Object.hasOwn(value, 'backgroundImage') ? ' · vlastní' : ' · děděné'}`} value={effective.backgroundImage} disabled={disabled} onReady={next => set('backgroundImage', next)} />
    <label className="form-field">Ztmavení obrázku · {effective.backgroundOverlay} % <small>{origin('backgroundOverlay')}</small><input type="range" min="0" max="100" value={effective.backgroundOverlay} disabled={disabled} onChange={event => set('backgroundOverlay', Number(event.target.value))} /></label>
    {lockLayout && <p className="field-help">Promítané otázky používají jednotné rozložení. U obrázkových otázek je text vlevo a fotka vpravo.</p>}
    <details className="editor-extra"><summary>{lockLayout ? 'Typografie a doplňky' : 'Typografie, rozložení a doplňky'}</summary>
      <div className="design-field-grid">
        <label className="form-field">Písmo <small>{origin('fontFamily')}</small><select disabled={disabled} value={effective.fontFamily} onChange={event => set('fontFamily', event.target.value as SlideDesign['fontFamily'])}><option value="sans">Čisté bezpatkové</option><option value="serif">Klasické patkové</option><option value="display">Výrazné titulkové</option></select></label>
        {!lockLayout && <label className="form-field">Zarovnání <small>{origin('textAlign')}</small><select disabled={disabled} value={effective.textAlign} onChange={event => set('textAlign', event.target.value as SlideDesign['textAlign'])}><option value="left">Vlevo</option><option value="center">Na střed</option><option value="right">Vpravo</option></select></label>}
        <label className="form-field">Velikost textu · {Math.round(effective.fontScale * 100)} % <small>{origin('fontScale')}</small><input disabled={disabled} type="range" min="0.75" max="1.5" step="0.05" value={effective.fontScale} onChange={event => set('fontScale', Number(event.target.value))} /></label>
        {!lockLayout && <>
          <label className="form-field">Rozložení <small>{origin('layout')}</small><select disabled={disabled} value={effective.layout} onChange={event => set('layout', event.target.value as SlideDesign['layout'])}><option value="classic">Klasické</option><option value="centered">Na střed</option><option value="split">Text a obraz vedle sebe</option>{scope !== 'results' && <option value="image-first">Obraz v hlavní roli</option>}</select></label>
          <label className="form-field">Prostor pro text · {effective.textWidth} % <small>{origin('textWidth')}</small><input disabled={disabled} type="range" min="35" max="75" value={effective.textWidth} onChange={event => set('textWidth', Number(event.target.value))} /></label>
          {scope !== 'results' && <label className="form-field">Zobrazení obrázku <small>{origin('mediaFit')}</small><select disabled={disabled} value={effective.mediaFit} onChange={event => set('mediaFit', event.target.value as SlideDesign['mediaFit'])}><option value="contain">Celý obrázek</option><option value="cover">Vyplnit prostor ořezem</option></select></label>}
        </>}
      </div>
      <MediaUploadField kind="image" label="Logo" value={effective.logoImage} disabled={disabled} onReady={next => set('logoImage', next)} />
      <div className="design-toggles">{(['showLogo', 'showQuestionNumber', 'showRoundTitle'] as const).filter(key => scope !== 'results' || key === 'showLogo').map(key => <label key={key}><input type="checkbox" disabled={disabled} checked={effective[key]} onChange={event => set(key, event.target.checked)} />{{ showLogo: 'Zobrazit logo', showQuestionNumber: 'Zobrazit číslo otázky', showRoundTitle: 'Zobrazit název kola' }[key]} <small>{origin(key)}</small></label>)}</div>
      {Object.keys(value).some(editableFields) && <details><summary>Obnovit jednotlivou děděnou hodnotu</summary><div className="design-reset-fields">{Object.keys(value).filter(editableFields).map(key => <button key={key} type="button" disabled={disabled} onClick={() => { const next = { ...value }; delete next[key as keyof SlideDesign]; onChange(next); }}>{({ backgroundColor: 'Pozadí', textColor: 'Text', accentColor: 'Zvýraznění', backgroundImage: 'Obrázek pozadí', logoImage: 'Logo', backgroundOverlay: 'Ztmavení', fontFamily: 'Písmo', fontScale: 'Velikost textu', textAlign: 'Zarovnání', layout: 'Rozložení', textWidth: 'Prostor pro text', mediaFit: 'Ořez', showLogo: 'Viditelnost loga', showQuestionNumber: 'Číslo otázky', showRoundTitle: 'Název kola' } as Record<string, string>)[key] ?? 'Vlastní nastavení'} ↩</button>)}</div></details>}
    </details>
    {designContrastWarning(effective) && <p className="field-validation warning" role="status">Text a pozadí mají slabý kontrast. Zkontrolujte čitelnost na projekci; uložení je možné.</p>}
    {effective.backgroundImage && effective.backgroundOverlay < 50 && <p className="field-validation warning" role="status">Obrázkové pozadí může snížit čitelnost textu. Zkontrolujte náhled a podle potřeby přidejte ztmavení; uložení je možné.</p>}
  </section>;
}
