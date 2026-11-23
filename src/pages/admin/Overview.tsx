import { CalendarCheck, Mars, Radio, RadioTower, Square, UserCheck, Users, Venus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { backend, errorMessage } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useSettings } from '@/hooks/useSettings';
import { connectionOf } from '@/lib/devices';
import { formatDuration, formatNumber, formatTime, localeTag, pct, secondsBetween } from '@/lib/format';
import { useT } from '@/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge, LiveDot } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { AnimatedNumber, EmptyState, ErrorNote, PageHeader, StatCard } from '@/components/ui/misc';
import { GenderDonut, GenderLegend, StackedBars } from '@/components/charts/Charts';
import { DeviceCard } from '@/components/dashboard/DeviceCard';
import type { ActiveShift } from '@/types/domain';

export default function Overview() {
  const toast = useToast();
  const t = useT();
  const now = useNow(1000);
  const { data: settings } = useSettings();
  const today = useAsync(() => backend.getTodaySummary(), [], { live: ['events', 'shifts'], pollMs: 20_000 });
  const active = useAsync(() => backend.getActiveShifts(), [], { live: ['shifts', 'events'], pollMs: 15_000 });
  const devices = useAsync(() => backend.listDevices(), [], { live: ['devices', 'events'], pollMs: 10_000 });
  const employees = useAsync(() => backend.listEmployees(), [], { live: ['settings'] });

  const [forceEnd, setForceEnd] = useState<ActiveShift | null>(null);
  const [ending, setEnding] = useState(false);

  const summary = today.data;
  const threshold = settings?.device_offline_after_seconds ?? 90;
  const online = devices.data?.filter((d) => connectionOf(d, threshold, now) === 'online').length;
  const activeEmployees = employees.data?.filter((e) => e.role === 'employee' && e.is_active).length;
  const peak = summary?.hourly.reduce((best, h) => (h.male + h.female > best.male + best.female ? h : best), summary.hourly[0]);

  const doForceEnd = async () => {
    if (!forceEnd) return;
    setEnding(true);
    try {
      const s = await backend.endShift(forceEnd.id);
      toast.success(t('Shift closed'), `${forceEnd.employee_name}: ${formatNumber(s.total_count)}`);
      setForceEnd(null);
    } catch (e) {
      toast.error(t('Could not close shift'), errorMessage(e));
    } finally {
      setEnding(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('Overview')} description={t('Live operations for {business} — today, {date}.', {
        business: settings?.business_name ?? t('Workspace'),
        date: new Date().toLocaleDateString(localeTag(), { day: 'numeric', month: 'long' }),
      })} />
      {today.error && <ErrorNote message={today.error} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label={t('Visitors today')} value={summary?.total} icon={<Users className="h-4 w-4" />} accent="brand" index={0}
          hint={peak && summary!.total > 0 ? `${t('Peak')} ${String(peak.hour).padStart(2, '0')}:00` : t('No visitors yet')} />
        <StatCard label={t('Men')} value={summary?.male} icon={<Mars />} accent="male" index={1} hint={summary ? `${pct(summary.male, summary.total)}% ${t('of total')}` : undefined} />
        <StatCard label={t('Women')} value={summary?.female} icon={<Venus />} accent="female" index={2} hint={summary ? `${pct(summary.female, summary.total)}% ${t('of total')}` : undefined} />
        <StatCard label={t('Completed shifts')} value={summary?.completed_shifts} icon={<CalendarCheck className="h-4 w-4" />} index={3} hint={t('Ended today')} />
        <StatCard label={t('Active employees')} value={activeEmployees} icon={<UserCheck className="h-4 w-4" />} accent="ok" index={4}
          hint={summary ? `${summary.active_shifts} ${t('on shift now')}` : undefined} />
        <StatCard label={t('Devices online')} value={online === undefined ? undefined : `${online}/${devices.data!.length}`} icon={<RadioTower className="h-4 w-4" />}
          accent={online === devices.data?.length ? 'ok' : 'warn'} index={5} hint={online === devices.data?.length ? t('All turnstiles reporting') : t('Check device status')} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Active shift */}
        <Card className="xl:col-span-2">
          <CardHeader title={t('Active shift')} subtitle={t('Counting in real time')} icon={<Radio className="h-4 w-4" />}
            action={active.data?.length ? <Badge key="live" tone="ok"><LiveDot /> {t('Live')}</Badge> : <Badge key="idle">{t('Idle')}</Badge>} />
          <CardBody>
            {!active.data?.length ? (
              <EmptyState icon={<CalendarCheck className="h-5 w-5" />} title={t('No active shift')}
                description={summary && summary.unassigned > 0
                  ? t('{count} passages today happened outside any shift — they are stored and visible in reports.', { count: summary.unassigned })
                  : t('Passages are attributed to a shift once an employee starts one.')} />
            ) : (
              <div className="space-y-3">
                {active.data.map((s) => (
                  <div key={s.id} className="flex flex-col gap-5 rounded-2xl border bg-elevated/30 p-5 md:flex-row md:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand/80 to-female/70 text-lg font-semibold text-white">
                        {s.employee_name.slice(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{s.employee_name}</div>
                        <div className="text-xs text-subtle">
                          {t('Since')} {formatTime(s.start_time)} · <span className="font-mono notranslate">{formatDuration(secondsBetween(s.start_time, new Date(now).toISOString()), true)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-6 text-center">
                      <div><div className="text-xs text-male">{t('Men')}</div><div className="text-2xl font-semibold tabular notranslate"><AnimatedNumber value={s.male_count} /></div></div>
                      <div><div className="text-xs text-female">{t('Women')}</div><div className="text-2xl font-semibold tabular notranslate"><AnimatedNumber value={s.female_count} /></div></div>
                      <div><div className="text-xs text-subtle">{t('Total')}</div><div className="text-2xl font-semibold tabular notranslate"><AnimatedNumber value={s.total_count} /></div></div>
                    </div>
                    <Button variant="danger" size="sm" icon={<Square className="h-3.5 w-3.5" />} onClick={() => setForceEnd(s)}>{t('Force end')}</Button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Gender split */}
        <Card>
          <CardHeader title={t('Gender split')} subtitle={t('Today')} />
          <CardBody className="space-y-4">
            <GenderDonut male={summary?.male ?? 0} female={summary?.female ?? 0} height={190} />
            <GenderLegend male={summary?.male ?? 0} female={summary?.female ?? 0} />
          </CardBody>
        </Card>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title={t('Visitors by hour')} subtitle={t('Today, men and women stacked')}
              action={<Link to="/admin/analytics" className="text-xs font-medium text-brand hover:underline">{t('Full analytics →')}</Link>} />
            <CardBody>
              <StackedBars data={summary?.hourly ?? []} xKey="hour" xFormatter={(h) => `${String(h).padStart(2, '0')}:00`} />
            </CardBody>
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title={t('Turnstiles')} subtitle={t('Connection & health')}
              action={<Link to="/admin/devices" className="text-xs font-medium text-brand hover:underline">{t('Manage →')}</Link>} />
            <CardBody className="space-y-3">
              {devices.data?.map((d) => <DeviceCard key={d.id} device={d} offlineAfter={threshold} now={now} compact />)}
            </CardBody>
          </Card>
        </div>
      </div>

      <Modal open={Boolean(forceEnd)} onClose={() => setForceEnd(null)} title={t('Force end this shift?')}
        description={forceEnd ? t('{name}’s shift will be closed with its current counts and marked “closed by admin”.', { name: forceEnd.employee_name }) : undefined}
        footer={<>
          <Button variant="ghost" onClick={() => setForceEnd(null)}>{t('Cancel')}</Button>
          <Button variant="danger" onClick={doForceEnd} loading={ending}>{t('Force end')}</Button>
        </>} />
    </div>
  );
}
