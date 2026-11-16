export interface PublicAppConfig { projectId: string; useEmulators: boolean }

export function publicAppOrigin(config: PublicAppConfig, localOrigin: string): string {
  if (!config.useEmulators && config.projectId === 'filmovy-kviz-v2-staging') return 'https://justkviz.cz';
  if (config.useEmulators && config.projectId.startsWith('demo-')) {
    const local = new URL(localOrigin);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(local.hostname) || !['http:', 'https:'].includes(local.protocol) || local.username || local.password) throw new Error('Neplatný lokální origin.');
    return local.origin;
  }
  throw new Error('Veřejný origin není nakonfigurován.');
}
