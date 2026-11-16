import { getFirebaseAppContext } from './app';

export function quizMediaEndpoint(): URL {
  const { config } = getFirebaseAppContext();
  const project = config.options.projectId;
  return new URL(config.useEmulators
    ? `http://127.0.0.1:5001/${project}/europe-west1/readQuizMedia`
    : `https://europe-west1-${project}.cloudfunctions.net/readQuizMedia`);
}
