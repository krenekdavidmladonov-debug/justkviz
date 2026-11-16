interface ShellProof {
    readonly type: 'offline-shell-proof';
    readonly version: string;
    readonly ready: boolean;
}
export async function checkOfflineShell(): Promise<ShellProof> {
    const registration = await navigator.serviceWorker?.getRegistration('/offline.html');
    const worker = registration?.active;
    if (!worker) {
        throw new Error('Offline aplikace ještě není nainstalovaná. Připravte ji s připojením před odjezdem.');
    }
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel(), timer = window.setTimeout(() => {
            channel.port1.close();
            reject(new Error('Offline spuštění aplikace nebylo potvrzené.'));
        }, 10000);
        channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
            window.clearTimeout(timer);
            channel.port1.close();
            if (!data || typeof data !== 'object' || (data as ShellProof).type !== 'offline-shell-proof' || !(data as ShellProof).ready) {
                reject(new Error('Některá součást offline aplikace chybí. Připravte ji znovu online.'));
            }
            else {
                resolve(data as ShellProof);
            }
        };
        worker.postMessage({ type: 'VERIFY_OFFLINE_SHELL' }, [channel.port2]);
    });
}
export async function installOfflineShell(): Promise<ShellProof> {
    if (!window.isSecureContext || !navigator.serviceWorker) {
        throw new Error('Offline instalace vyžaduje podporovaný Chrome a bezpečnou adresu.');
    }
    try {
        const registration = await navigator.serviceWorker.register('/offline-sw.js', { scope: '/offline.html', updateViaCache: 'none' });
        // Keep the active shell in control of its open clients. A new worker
        // becomes active only after Chrome releases the previous version.
        if (registration.active) {
            await registration.update();
        } else {
            const worker = registration.installing ?? registration.waiting;
            if (worker) {
                await new Promise<void>((resolve, reject) => {
                    const finish = (error?: Error) => {
                        window.clearTimeout(timer);
                        worker.removeEventListener('statechange', changed);
                        if (error) reject(error);
                        else resolve();
                    };
                    const changed = () => {
                        if (worker.state === 'activated') finish();
                        else if (worker.state === 'redundant') finish(new Error('Instalace offline aplikace selhala.'));
                    };
                    const timer = window.setTimeout(() => finish(new Error('Instalace offline aplikace nebyla dokončena.')), 30000);
                    worker.addEventListener('statechange', changed);
                    changed();
                });
            }
        }
        return await checkOfflineShell();
    } catch {
        throw new Error('Aplikaci se nepodařilo uložit pro offline spuštění. Zkontrolujte volné místo a oprávnění prohlížeče a zkuste přípravu znovu.');
    }
}

/** Executes the cached entry under an enforced connect-src 'none' policy. */
export async function testOfflineShellBoot(): Promise<void> {
    await checkOfflineShell();
    const nonce = crypto.randomUUID();
    const iframe = document.createElement('iframe');
    iframe.hidden = true;
    iframe.title = 'Zkouška spuštění offline aplikace';
    iframe.src = `/offline.html?offlineSelfTest=${encodeURIComponent(nonce)}#/self-test/${nonce}`;
    await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            window.clearTimeout(timer);
            window.removeEventListener('message', receive);
            iframe.remove();
        };
        const receive = (event: MessageEvent<unknown>) => {
            if (event.source !== iframe.contentWindow || event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
            const data = event.data as Record<string, unknown>;
            if (data.type !== 'offline-shell-boot-proof' || data.nonce !== nonce) return;
            cleanup();
            if (data.ready === true) resolve();
            else reject(new Error('Offline aplikace se bez síťového připojení nespustila. Připravte ji znovu.'));
        };
        const timer = window.setTimeout(() => {
            cleanup();
            reject(new Error('Spuštění celé offline aplikace nebylo potvrzeno.'));
        }, 20000);
        window.addEventListener('message', receive);
        document.body.append(iframe);
    });
}

export async function proveOfflineShellBoot(nonce: string): Promise<void> {
    if (window.parent === window || new URL(location.href).searchParams.get('offlineSelfTest') !== nonce) return;
    let receivedViolation: (() => void) | undefined;
    const violation = new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Síťová izolace nebyla potvrzena.')), 3000);
        receivedViolation = () => { window.clearTimeout(timer); resolve(); };
    });
    const blocked = (event: SecurityPolicyViolationEvent) => {
        if (event.effectiveDirective === 'connect-src' && event.disposition === 'enforce') receivedViolation?.();
    };
    document.addEventListener('securitypolicyviolation', blocked);
    try {
        const request = fetch(`/justkviz-connection-check.txt?offlineProbe=${encodeURIComponent(nonce)}`, { cache: 'no-store' });
        await Promise.all([violation, request.then(() => { throw new Error('Síťové spojení nebylo zablokováno.'); }, () => undefined)]);
        await checkOfflineShell();
        window.parent.postMessage({ type: 'offline-shell-boot-proof', nonce, ready: true }, location.origin);
    } catch {
        window.parent.postMessage({ type: 'offline-shell-boot-proof', nonce, ready: false }, location.origin);
    } finally {
        document.removeEventListener('securitypolicyviolation', blocked);
    }
}
