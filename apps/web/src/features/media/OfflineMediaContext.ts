import { createContext } from 'react';
export interface OfflineMediaResolver {
  readonly epoch:string;
  readonly resolve:(reference:string,signal:AbortSignal)=>Promise<Blob>;
}
/** Only an unlocked offline operator or its pinned, sanitized projector supplies this resolver. */
export const OfflineMediaContext=createContext<OfflineMediaResolver|null>(null);
