import { emulatorEndpoint } from './emulatorEndpoint';
import { getFirebaseAppContext } from './app';

export function quizMediaEndpoint(): URL {
  const { config } = getFirebaseAppContext();
  const project = config.options.projectId;
  return new URL(config.useEmulators
    ? `${emulatorEndpoint(project, 'FUNCTIONS').origin}/${project}/europe-west1/readQuizMedia`
    : `https://europe-west1-${project}.cloudfunctions.net/readQuizMedia`);
}
