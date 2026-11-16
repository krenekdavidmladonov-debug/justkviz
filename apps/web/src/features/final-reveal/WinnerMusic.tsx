import { useState } from 'react';
import { YouTubePlayer } from '../presentation/YouTubePlayer';

// Queen Official. This is intentionally a visible official player on the moderator's device.
export const winnerMusic = { source: 'https://www.youtube.com/watch?v=04854XqcfCY', start: 30, fadeInSeconds: 3 };

/** Mounted only by the operator who received a fresh, confirmed winner command. */
export function WinnerMusic() {
  const [generation, setGeneration] = useState(1);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState(false);
  return <section className="winner-music" aria-label="Hudba pro vítěze">
    <strong>Queen · We Are the Champions</strong>
    <YouTubePlayer source={winnerMusic.source} startSeconds={winnerMusic.start} fadeInSeconds={winnerMusic.fadeInSeconds}
      command={stopped ? 'stop' : 'play'} generation={generation} allowManualAutoplay
      className="winner-youtube-player" onFinished={() => setStopped(true)}
      onError={() => { setStopped(true); setError(true); }} />
    {error && <p role="alert">YouTube hudbu nespustil. Zkuste ji spustit znovu v přehrávači.</p>}
    <button type="button" className="secondary-button" onClick={() => {
      setError(false); setStopped(value => !value); setGeneration(value => value + 1);
    }}>{stopped ? 'Spustit hudbu' : 'Zastavit hudbu'}</button>
  </section>;
}
