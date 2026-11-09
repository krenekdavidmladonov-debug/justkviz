const projectorWindowName = 'filmovy-kviz-projector';

export const projectorPopupBlockedMessage = 'Prohlížeč zablokoval otevření projektoru. Povolte vyskakovací okna a zkuste to znovu.';
export const projectorFullscreenFailureMessage = 'Celá obrazovka se nepodařila spustit. Použijte fullscreen prohlížeče.';

let projectorWindow: Window | null = null;
let projectorUrl: string | null = null;

export function managedProjectorWindow(): Window | null {
  return projectorWindow && !projectorWindow.closed ? projectorWindow : null;
}

export function openOrFocusProjector(url: string): Window | null {
  if (projectorWindow && !projectorWindow.closed) {
    if (projectorUrl !== url) projectorWindow.location.href = url;
    projectorUrl = url;
    projectorWindow.focus();
    return projectorWindow;
  }
  projectorWindow = window.open(url, projectorWindowName, 'popup=yes');
  projectorUrl = projectorWindow === null ? null : url;
  projectorWindow?.focus();
  return projectorWindow;
}

export async function requestProjectorFullscreen(element: HTMLElement = document.documentElement): Promise<boolean> {
  if (document.fullscreenElement) return true;
  try {
    await element.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}
