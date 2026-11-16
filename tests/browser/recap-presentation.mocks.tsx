import React from 'react';

const frame = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#183849"/><rect x="4" y="4" width="1592" height="892" fill="none" stroke="#f3b33d" stroke-width="8"/><path d="M0 0h160v160H0zm1440 0h160v160h-160zM0 740h160v160H0zm1440 0h160v160h-160z" fill="#f3b33d"/><text x="800" y="460" text-anchor="middle" font-family="Arial" font-size="70" fill="white">Celý obraz 16 : 9</text></svg>';
const image = `data:image/svg+xml,${encodeURIComponent(frame)}`;

// Media transport/lifecycle has separate mounted tests. This fixture isolates the real slide layout.
export function MediaPlayer({ className, source }: { readonly className?: string; readonly source: string }) {
  return <div className={className}><div className="youtube-player-host">{source.endsWith('.mp4')
    ? <video poster={image} aria-label="Syntetické video" />
    : <iframe title="Syntetické YouTube video" srcDoc={`<body style="margin:0;background:#000;display:grid;place-items:center;height:100vh"><img src="${image}" style="width:100%;height:100%;object-fit:contain"></body>`} />}</div>{source === 'blocked' && <button className="secondary-button">Spustit video ručně</button>}</div>;
}
export function AssetImage({ alt }: { readonly source: string; readonly alt: string }) {
  return <img src={image} alt={alt} />;
}
