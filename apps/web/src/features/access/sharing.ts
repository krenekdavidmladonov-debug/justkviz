import { publicAppOrigin, type PublicAppConfig } from '../../services/publicAppOrigin';

export function accessInvitationUrl(inviteId: string, token: string, config: PublicAppConfig, localOrigin: string): string {
  return `${publicAppOrigin(config, localOrigin)}/invite/${encodeURIComponent(inviteId)}#token=${encodeURIComponent(token)}`;
}
