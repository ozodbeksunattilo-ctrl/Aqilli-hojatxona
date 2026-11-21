import type { Device } from '@/types/domain';

export type Connection = 'online' | 'offline' | 'never_seen' | 'disabled' | 'maintenance';

/** Online = heard from within the configured threshold (heartbeat or event). */
export function connectionOf(d: Device, offlineAfterSeconds: number, now = Date.now()): Connection {
  if (d.status === 'disabled') return 'disabled';
  if (!d.last_seen) return 'never_seen';
  const online = now - new Date(d.last_seen).getTime() <= offlineAfterSeconds * 1000;
  if (d.status === 'maintenance') return online ? 'maintenance' : 'offline';
  return online ? 'online' : 'offline';
}

export const connectionLabel: Record<Connection, string> = {
  online: 'Online',
  offline: 'Offline',
  never_seen: 'Not connected yet',
  disabled: 'Disabled',
  maintenance: 'Maintenance',
};

export const connectionTone = {
  online: 'ok',
  offline: 'danger',
  never_seen: 'neutral',
  disabled: 'neutral',
  maintenance: 'warn',
} as const;
