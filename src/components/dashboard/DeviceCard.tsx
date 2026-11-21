import { Cpu, Wifi, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { connectionLabel, connectionOf, connectionTone } from '@/lib/devices';
import { relativeTime } from '@/lib/format';
import { Badge, LiveDot } from '@/components/ui/Badge';
import type { Device } from '@/types/domain';

export function DeviceCard({ device, offlineAfter, now, children, compact }: {
  device: Device;
  offlineAfter: number;
  now: number;
  children?: ReactNode;
  compact?: boolean;
}) {
  const conn = connectionOf(device, offlineAfter, now);
  const male = device.restroom_type === 'male';
  return (
    <div className={cn('rounded-2xl border bg-elevated/30 p-4', !compact && 'sm:p-5')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', male ? 'bg-male/10 text-male' : 'bg-female/10 text-female')}>
            <Cpu className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{device.device_name}</div>
            <div className="font-mono notranslate text-[11px] text-subtle">{device.id}</div>
          </div>
        </div>
        <Badge tone={connectionTone[conn]}>
          {conn === 'online' ? <LiveDot /> : conn === 'offline' ? <WifiOff className="h-3 w-3" /> : null}
          {connectionLabel[conn]}
        </Badge>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <dt className="text-subtle">Last seen</dt>
        <dd className="text-right font-medium">{relativeTime(device.last_seen)}</dd>
        <dt className="text-subtle">Last passage</dt>
        <dd className="text-right font-medium">{relativeTime(device.last_event_at)}</dd>
        {!compact && (
          <>
            <dt className="text-subtle">Firmware</dt>
            <dd className="text-right font-mono notranslate">{device.firmware_version ?? '—'}</dd>
            <dt className="text-subtle">Offline queue</dt>
            <dd className={cn('text-right font-medium', (device.queue_depth ?? 0) > 0 && 'text-warn')}>
              {device.queue_depth == null ? '—' : `${device.queue_depth} event${device.queue_depth === 1 ? '' : 's'}`}
            </dd>
            <dt className="text-subtle">Health</dt>
            <dd className="flex items-center justify-end gap-1.5 font-medium">
              <Wifi className={cn('h-3 w-3', conn === 'online' ? 'text-ok' : 'text-subtle')} />
              {conn === 'online' ? ((device.queue_depth ?? 0) > 0 ? 'Syncing backlog' : 'Healthy') : conn === 'never_seen' ? 'Awaiting first contact' : 'Check controller'}
            </dd>
          </>
        )}
      </dl>
      {children && <div className="mt-4 border-t pt-4">{children}</div>}
    </div>
  );
}
