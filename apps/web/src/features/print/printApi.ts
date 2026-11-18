import { emulatorEndpoint } from '../../services/firebase/emulatorEndpoint';
import { getFirebaseAppContext } from '../../services/firebase/app';
import { getFirebaseAuth } from '../../services/firebase/auth';
import type { PrintArtifactBlob, PrintOptions } from './types';

function endpointUrl(): string {
  const { config } = getFirebaseAppContext();
  const projectId = config.options.projectId;
  if (!projectId) throw new Error('Chybí Firebase project ID.');
  return config.useEmulators
    ? `${emulatorEndpoint(projectId, 'FUNCTIONS').origin}/${projectId}/europe-west1/generatePrintArtifact`
    : `https://europe-west1-${projectId}.cloudfunctions.net/generatePrintArtifact`;
}

function responseFilename(header: string | null): string {
  const match = /filename="?([^";]+)"?/iu.exec(header ?? '');
  return match?.[1] ?? 'justkviz.pdf';
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: unknown };
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
  } catch {
    // The endpoint may fail before producing its JSON error envelope.
  }
  return 'PDF se nepodařilo vytvořit. Zkuste to znovu.';
}

export async function generatePrintArtifact(eventId: string, options: PrintOptions, signal?: AbortSignal): Promise<PrintArtifactBlob> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error('Přihlášení je vyžadováno.');
  const token = await user.getIdToken();
  signal?.throwIfAborted();
  const response = await fetch(endpointUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ eventId, options }),
    signal,
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const contentType = response.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('application/pdf')) {
    throw new Error('Server nevrátil platný PDF dokument.');
  }
  return {
    blob: await response.blob(),
    filename: responseFilename(response.headers.get('content-disposition')),
  };
}
