import { CalendarCheck, Cpu, Radio, Square, UserCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { backend, errorMessage } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useSettings } from '@/hooks/useSettings';
import { connectionOf } from '@/lib/devices';
import { formatDuration, formatNumber, formatTime, pct, secondsBetween } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge, LiveDot } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { AnimatedNumber, EmptyState, ErrorNote, PageHeader, StatCard } from '@/components/ui/misc';
import { GenderDonut, GenderLegend, StackedBars } from '@/components/charts/Charts';
import { EventFeed } from '@/components/dashboard/EventFeed';
import { DeviceCard } from '@/components/dashboard/DeviceCard';
import { SimulatorPanel } from '@/components/dashboard/SimulatorPanel';
import type { ActiveShift } from '@/types/domain';

export default function Overview() {
  const toast = useToast();
  const now = useNow(1000);
  const { data: settings } = useSettings();
  const today = useAsync(() => backend.getTodaySummary(), [], { live: ['events', 'shifts'], pollMs: 20_000 });
  const active = useAsync(() => backend.getActiveShifts(), [], { live: ['shifts', 'events'], pollMs: 15_000 });
  const events = useAsync(() => backend.listEvents({ limit: 30 }), [], { live: ['events'] });
  const devices = useAsync(() => backend.listDevices(), [], { live: ['devices', 'events'], pollMs: 10_000 });
  const employees = useAsync(() => backend.listEmployees(), [], { live: ['settings'] });

  const [forceEnd, setForceEnd] = useState<ActiveShift | null>(null);
  const [ending, setEnding] = useState(false);

  const t = today.data;
  const threshold = settings?.device_offline_after_seconds ?? 90;
  const online = devices.data?.filter((d) => connectionOf(d, threshold, now) === 'online').length;
  const activeEmployees = employees.data?.filter((e) => e.role === 'employee' && e.is_active).length;
  const peak = t?.hourly.reduce((best, h) => (h.male + h.female > best.male + best.female ? h : best), t.hourly[0]);

  const doForceEnd = async () => {
    if (!forceEnd) return;
    setEnding(true);
    try {
      const s = await backend.endShift(forceEnd.id);
      toast.success('Shift closed', `${forceEnd.employee_name}: ${formatNumber(s.total_count)} visitors saved.`);
      setForceEnd(null);
    } catch (e) {
      toast.error('Could not close shift', errorMessage(e));
    } finally {
      setEnding(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description={`Live operations for ${settings?.business_name ?? 'your business'} — today, ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`} />
      {today.error && <ErrorNote message={today.error} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Visitors today" value={t?.total} icon={<Users className="h-4 w-4" />} accent="brand" index={0}
          hint={peak && t!.total > 0 ? `Peak ${String(peak.hour).padStart(2, '0')}:00` : 'No visitors yet'} />
        <StatCard label="Men" value={t?.male} icon={<span translate="no" className="notranslate text-xs font-bold">M</span>} accent="male" index={1} hint={t ? `${pct(t.male, t.total)}% of total` : undefined} />
        <StatCard label="Women" value={t?.female} icon={<span translate="no" className="notranslate text-xs font-bold">W</span>} accent="female" index={2} hint={t ? `${pct(t.female, t.total)}% of total` : undefined} />
        <StatCard label="Completed shifts" value={t?.completed_shifts} icon={<CalendarCheck className="h-4 w-4" />} index={3} hint="Ended today" />
        <StatCard label="Active employees" value={activeEmployees} icon={<UserCheck className="h-4 w-4" />} accent="ok" index={4}
          hint={t ? `${t.active_shifts} on shift now` : undefined} />
        <StatCard label="Devices online" value={online === undefined ? undefined : `${online}/${devices.data!.length}`} icon={<Cpu className="h-4 w-4" />}
          accent={online === devices.data?.length ? 'ok' : 'warn'} index={5} hint={online === devices.data?.length ? 'All turnstiles reporting' : 'Check device status'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Active shift */}
        <Card className="xl:col-span-2">
          <CardHeader title="Active shift" subtitle="Counting in real time" icon={<Radio className="h-4 w-4" />}
            action={active.data?.length ? <Badge key="live" tone="ok"><LiveDot /> Live</Badge> : <Badge key="idle">Idle</Badge>} />
          <CardBody>
            {!active.data?.length ? (
              <EmptyState icon={<CalendarCheck className="h-5 w-5" />} title="No active shift"
                description={t && t.unassigned > 0 ? `${t.unassigned} passage(s) today happened outside any shift — they are stored and visible in reports.` : 'Passages are attributed to a shift once an employee starts one.'} />
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
                          Since {formatTime(s.start_time)} · <span className="font-mono notranslate">{formatDuration(secondsBetween(s.start_time, new Date(now).toISOString()), true)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-6 text-center">
                      <div><div className="text-xs text-male">Men</div><div className="text-2xl font-semibold tabular notranslate"><AnimatedNumber value={s.male_count} /></div></div>
                      <div><div className="text-xs text-female">Women</div><div className="text-2xl font-semibold tabular notranslate"><AnimatedNumber value={s.female_count} /></div></div>
                      <div><div className="text-xs text-subtle">Total</div><div className="text-2xl font-semibold tabular notranslate"><AnimatedNumber value={s.total_count} /></div></div>
                    </div>
                    <Button variant="danger" size="sm" icon={<Square className="h-3.5 w-3.5" />} onClick={() => setForceEnd(s)}>Force end</Button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Gender split */}
        <Card>
          <CardHeader title="Gender split" subtitle="Today" />
          <CardBody className="space-y-4">
            <GenderDonut male={t?.male ?? 0} female={t?.female ?? 0} height={190} />
            <GenderLegend male={t?.male ?? 0} female={t?.female ?? 0} />
          </CardBody>
        </Card>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Visitors by hour" subtitle="Today, men and women stacked"
              action={<Link to="/admin/analytics" className="text-xs font-medium text-brand hover:underline">Full analytics →</Link>} />
            <CardBody>
              <StackedBars data={t?.hourly ?? []} xKey="hour" xFormatter={(h) => `${String(h).padStart(2, '0')}:00`} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Live event stream" subtitle="Latest confirmed passages from all turnstiles" action={<Badge tone="ok" dot>Realtime</Badge>} />
            <CardBody><EventFeed events={events.data} loading={events.loading} /></CardBody>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Turnstiles" subtitle="Connection & health"
              action={<Link to="/admin/devices" className="text-xs font-medium text-brand hover:underline">Manage →</Link>} />
            <CardBody className="space-y-3">
              {devices.data?.map((d) => <DeviceCard key={d.id} device={d} offlineAfter={threshold} now={now} compact />)}
            </CardBody>
          </Card>
          {settings?.system_mode === 'demo' && <SimulatorPanel />}
        </div>
      </div>

      <Modal open={Boolean(forceEnd)} onClose={() => setForceEnd(null)} title="Force end this shift?"
        description={forceEnd ? `${forceEnd.employee_name}'s shift will be closed with its current counts and marked "closed by admin".` : undefined}
        footer={<>
          <Button variant="ghost" onClick={() => setForceEnd(null)}>Cancel</Button>
          <Button variant="danger" onClick={doForceEnd} loading={ending}>Force end</Button>
        </>} />
    </div>
  );
}
