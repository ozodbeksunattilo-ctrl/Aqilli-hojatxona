import { Wifi, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { connectionLabelKey, connectionOf, connectionTone } from '@/lib/devices';
import { formatNumber, relativeTime } from '@/lib/format';
import { useT } from '@/i18n/I18nProvider';
import { Badge, LiveDot } from '@/components/ui/Badge';
import { GenderFigure } from '@/components/ui/GenderFigure';
import type { Device } from '@/types/domain';

export function DeviceCard({ device, offlineAfter, now, children, compact }: {
  device: Device;
  offlineAfter: number;
  now: number;
  children?: ReactNode;
  compact?: boolean;
}) {
  const t = useT();
  const conn = connectionOf(device, offlineAfter, now);
  const male = device.restroom_type === 'male';
  return (
    <div className={cn('min-w-0 rounded-2xl border bg-elevated/30 p-4', !compact && 'sm:p-5')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn('icon-tile h-11 w-11 rounded-2xl [&_svg]:h-6 [&_svg]:w-6', male ? 'tone-male' : 'tone-female')}>
            <GenderFigure gender={device.restroom_type} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{device.device_name}</div>
            <div className="font-mono notranslate text-[11px] text-subtle">{device.id}</div>
          </div>
        </div>
        <Badge tone={connectionTone[conn]}>
          {conn === 'online' ? <LiveDot /> : conn === 'offline' ? <WifiOff className="h-3 w-3" /> : null}
          {t(connectionLabelKey[conn])}
        </Badge>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <dt className="text-subtle">{t('Last seen')}</dt>
        <dd className="text-right font-medium">{relativeTime(device.last_seen)}</dd>
        <dt className="text-subtle">{t('Last passage')}</dt>
        <dd className="text-right font-medium">{relativeTime(device.last_event_at)}</dd>
        {!compact && (
          <>
            <dt className="text-subtle">{t('Firmware')}</dt>
            <dd className="text-right font-mono notranslate">{device.firmware_version ?? '—'}</dd>
            <dt className="text-subtle">{t('Offline queue')}</dt>
            <dd className={cn('text-right font-medium', (device.queue_depth ?? 0) > 0 && 'text-warn')}>
              {device.queue_depth == null ? '—' : `${formatNumber(device.queue_depth)} ${t('events')}`}
            </dd>
            <dt className="text-subtle">{t('Health')}</dt>
            <dd className="flex items-center justify-end gap-1.5 font-medium">
              <Wifi className={cn('h-3 w-3', conn === 'online' ? 'text-ok' : 'text-subtle')} />
              {conn === 'online' ? ((device.queue_depth ?? 0) > 0 ? t('Syncing backlog') : t('Healthy')) : conn === 'never_seen' ? t('Awaiting first contact') : t('Check controller')}
            </dd>
          </>
        )}
      </dl>
      {children && <div className="mt-4 border-t pt-4">{children}</div>}
    </div>
  );
}
