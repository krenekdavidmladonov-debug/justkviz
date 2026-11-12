import type { FormEvent } from 'react';

import type { RegistrationFormValues } from '../events/registrationApi';

export interface RegistrationDraftValues extends Omit<RegistrationFormValues, 'memberCount'> {
  readonly memberCount: number | null;
}

export function RegistrationForm({ values, minimum, maximum, pending, submitLabel, onChange, onSubmit }: {
  readonly values: RegistrationDraftValues;
  readonly minimum: number;
  readonly maximum: number;
  readonly pending: boolean;
  readonly submitLabel: string;
  readonly onChange: (values: RegistrationDraftValues) => void;
  readonly onSubmit: (values: RegistrationFormValues) => void;
}) {
  const teamMaximum = Math.min(4, maximum);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const memberCount = values.memberCount;
    if (pending || memberCount === null || !Number.isInteger(memberCount) || memberCount < minimum || memberCount > teamMaximum) return;
    onSubmit({ ...values, memberCount });
  };
  return <form className="registration-form" onSubmit={submit}>
    <label className="editor-field"><span>Název týmu *</span><input required minLength={2} maxLength={80} value={values.teamName} onChange={(e) => onChange({ ...values, teamName: e.target.value })} /></label>
    <label className="editor-field"><span>Počet členů *</span><input required type="number" inputMode="numeric" step={1} min={minimum} max={teamMaximum} value={values.memberCount ?? ''} onChange={(e) => onChange({ ...values, memberCount: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : null })} /><small>Povolená velikost: {minimum}–{teamMaximum}.</small></label>
    <label className="editor-field"><span>E-mail *</span><input required type="email" maxLength={254} value={values.contactEmail} onChange={(e) => onChange({ ...values, contactEmail: e.target.value })} /></label>
    <p><a href="/privacy">Ochrana osobních údajů</a> — informace o registraci a správě údajů.</p>
    <button className="primary-button" type="submit" disabled={pending}>{pending ? 'Ukládám…' : submitLabel}</button>
  </form>;
}
