import { motion } from 'framer-motion';
import { Activity, Clock, Play, Square, Timer, Users } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { backend, errorMessage } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useSettings } from '@/hooks/useSettings';
import { connectionOf } from '@/lib/devices';
import { formatDuration, formatNumber, formatTime, greeting, secondsBetween } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge, LiveDot } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { AnimatedNumber, ErrorNote } from '@/components/ui/misc';
import { LiveCounterCard } from '@/components/dashboard/LiveCounterCard';
import { EventFeed } from '@/components/dashboard/EventFeed';
import type { Shift } from '@/types/domain';

export function EmployeeDashboard() {
  const { profile } = useAuth();
  const toast = useToast();
  const now = useNow(1000);
  const { data: settings } = useSettings();
  const active = useAsync(() => backend.getActiveShifts(), [], { live: ['shifts', 'events'], pollMs: 15_000 });
  const today = useAsync(() => backend.getTodaySummary(), [], { live: ['events', 'shifts'], pollMs: 20_000 });
  const devices = useAsync(() => backend.listDevices(), [], { live: ['devices'], pollMs: 15_000 });

  const mine = active.data?.find((s) => s.employee_id === profile?.id);
  const other = active.data?.find((s) => s.employee_id !== profile?.id);
  const events = useAsync(
    () => (mine ? backend.listEvents({ shiftId: mine.id, limit: 25 }) : Promise.resolve([])),
    [mine?.id],
    { live: ['events'] },
  );

  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [summary, setSummary] = useState<Shift | null>(null);

  const start = async () => {
    setBusy(true);
    try {
      await backend.startShift();
      toast.success('Shift started', 'Visitor counting is now assigned to your shift.');
      await active.reload();
    } catch (e) {
      toast.error('Could not start shift', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    if (!mine) return;
    setBusy(true);
    try {
      const done = await backend.endShift(mine.id);
      setConfirmEnd(false);
      setSummary(done);
      await Promise.all([active.reload(), today.reload()]);
    } catch (e) {
      toast.error('Could not end shift', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const threshold = settings?.device_offline_after_seconds ?? 90;
  const online = (id: string) => {
    const d = devices.data?.find((x) => x.id === id);
    return d ? connectionOf(d, threshold, now) === 'online' : null;
  };
  const elapsed = mine ? secondsBetween(mine.start_time, new Date(now).toISOString()) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-subtle">{greeting()},</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{profile?.full_name}</h1>
        </div>
        {mine ? (
          <Badge key="on" tone="ok" className="self-start px-3 py-1 text-xs sm:self-auto"><LiveDot className="mr-0.5" /> Shift in progress</Badge>
        ) : (
          <Badge key="off" className="self-start px-3 py-1 text-xs sm:self-auto">Off shift</Badge>
        )}
      </div>

      {active.error && <ErrorNote message={active.error} />}

      {/* Shift control */}
      <motion.div layout className="card relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand/[0.07] via-transparent to-transparent" />
        <div className="relative flex flex-col gap-6 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid flex-1 grid-cols-2 gap-6 sm:grid-cols-4">
            <div>
              <div className="label flex items-center gap-1.5"><Activity className="h-3 w-3" /> Status</div>
              <div className="mt-2 text-lg font-semibold">{mine ? 'Active' : other ? 'Location busy' : 'Not started'}</div>
            </div>
            <div>
              <div className="label flex items-center gap-1.5"><Clock className="h-3 w-3" /> Started</div>
              <div className="mt-2 text-lg font-semibold tabular notranslate">{mine ? formatTime(mine.start_time) : '—'}</div>
            </div>
            <div>
              <div className="label flex items-center gap-1.5"><Timer className="h-3 w-3" /> Duration</div>
              <div className="mt-2 font-mono notranslate text-lg font-semibold tabular notranslate">{mine ? formatDuration(elapsed, true) : '—'}</div>
            </div>
            <div>
              <div className="label flex items-center gap-1.5"><Users className="h-3 w-3" /> Shift total</div>
              <div className="mt-2 text-lg font-semibold tabular notranslate">{mine ? <AnimatedNumber value={mine.total_count} /> : '—'}</div>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            {mine ? (
              <Button variant="danger" size="lg" icon={<Square className="h-4 w-4" />} onClick={() => setConfirmEnd(true)} disabled={busy}>
                End shift
              </Button>
            ) : (
              <Button variant="success" size="lg" icon={<Play className="h-4 w-4" />} onClick={start} loading={busy}
                disabled={Boolean(other && settings?.single_shared_shift)}>
                Start shift
              </Button>
            )}
          </div>
        </div>
        {!mine && other && (
          <div className="relative border-t bg-warn/[0.05] px-6 py-3 text-[13px] text-warn">
            {other.employee_name} has been on shift since {formatTime(other.start_time)}. A new shift can start once it is ended.
          </div>
        )}
      </motion.div>

      {/* Counters */}
      <div className="grid gap-4 md:grid-cols-2">
        <LiveCounterCard gender="male" active={Boolean(mine)} shiftCount={mine ? mine.male_count : active.data ? 0 : undefined}
          todayCount={today.data?.male} deviceOnline={online('MEN-001')} />
        <LiveCounterCard gender="female" active={Boolean(mine)} shiftCount={mine ? mine.female_count : active.data ? 0 : undefined}
          todayCount={today.data?.female} deviceOnline={online('WOMEN-001')} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader title="Combined" subtitle="Both restrooms" icon={<Users className="h-4 w-4" />} />
          <CardBody className="space-y-5">
            <div>
              <div className="label">This shift</div>
              <div className="mt-1 text-5xl font-semibold tracking-tight tabular notranslate">{mine ? <AnimatedNumber value={mine.total_count} /> : 0}</div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-elevated">
              {mine && mine.total_count > 0 && (
                <div className="flex h-full">
                  <motion.div className="h-full bg-male" animate={{ width: `${(mine.male_count / mine.total_count) * 100}%` }} />
                  <motion.div className="h-full bg-female" animate={{ width: `${(mine.female_count / mine.total_count) * 100}%` }} />
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 border-t pt-4 text-sm">
              <div><div className="text-subtle">Today</div><div className="mt-1 font-semibold tabular notranslate">{formatNumber(today.data?.total)}</div></div>
              <div><div className="text-subtle">Men</div><div className="mt-1 font-semibold tabular notranslate text-male">{formatNumber(today.data?.male)}</div></div>
              <div><div className="text-subtle">Women</div><div className="mt-1 font-semibold tabular notranslate text-female">{formatNumber(today.data?.female)}</div></div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Live visitor events" subtitle={mine ? 'Confirmed passages in your shift' : 'Start a shift to see live events'}
            action={mine && <Badge tone="ok" dot>Live</Badge>} />
          <CardBody><EventFeed events={events.data} loading={events.loading} /></CardBody>
        </Card>
      </div>

      <Modal open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End your shift?"
        description="Counts are saved permanently and the shift can no longer receive new visitors."
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmEnd(false)}>Cancel</Button>
          <Button variant="danger" onClick={end} loading={busy}>End shift</Button>
        </>}>
        {mine && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-male/10 p-3"><div className="text-xs text-male">Men</div><div className="mt-1 text-xl font-semibold tabular notranslate">{formatNumber(mine.male_count)}</div></div>
            <div className="rounded-xl bg-female/10 p-3"><div className="text-xs text-female">Women</div><div className="mt-1 text-xl font-semibold tabular notranslate">{formatNumber(mine.female_count)}</div></div>
            <div className="rounded-xl bg-elevated p-3"><div className="text-xs text-subtle">Total</div><div className="mt-1 text-xl font-semibold tabular notranslate">{formatNumber(mine.total_count)}</div></div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(summary)} onClose={() => setSummary(null)} title="Shift completed" description="Great work — your shift has been saved."
        footer={<Button onClick={() => setSummary(null)}>Done</Button>}>
        {summary && (
          <div className="space-y-3 text-sm">
            {[
              ['Start', formatTime(summary.start_time)],
              ['End', formatTime(summary.end_time)],
              ['Duration', formatDuration(summary.duration_seconds)],
              ['Male visitors', formatNumber(summary.male_count)],
              ['Female visitors', formatNumber(summary.female_count)],
              ['Total visitors', formatNumber(summary.total_count)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-b pb-2 last:border-0"><span className="text-subtle">{k}</span><span className="font-semibold tabular notranslate">{v}</span></div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
