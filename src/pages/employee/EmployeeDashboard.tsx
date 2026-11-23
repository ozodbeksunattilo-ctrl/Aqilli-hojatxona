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
import { shiftVisitors } from '@/lib/shifts';
import { useT } from '@/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Badge, LiveDot } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { AnimatedNumber, ErrorNote } from '@/components/ui/misc';
import { LiveCounterCard } from '@/components/dashboard/LiveCounterCard';
import type { Shift } from '@/types/domain';

export function EmployeeDashboard() {
  const { profile } = useAuth();
  const toast = useToast();
  const t = useT();
  const now = useNow(1000);
  const { data: settings } = useSettings();
  const active = useAsync(() => backend.getActiveShifts(), [], { live: ['shifts', 'events'], pollMs: 15_000 });
  const today = useAsync(() => backend.getTodaySummary(), [], { live: ['events', 'shifts'], pollMs: 20_000 });
  const devices = useAsync(() => backend.listDevices(), [], { live: ['devices'], pollMs: 15_000 });

  const mine = active.data?.find((s) => s.employee_id === profile?.id);
  const other = active.data?.find((s) => s.employee_id !== profile?.id);

  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [summary, setSummary] = useState<Shift | null>(null);

  const start = async () => {
    setBusy(true);
    try {
      await backend.startShift();
      toast.success(t('Shift started'), t('Visitor counting is now assigned to your shift.'));
      await active.reload();
    } catch (e) {
      toast.error(t('Could not start shift'), errorMessage(e));
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
      toast.error(t('Could not end shift'), errorMessage(e));
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
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {mine ? (
            <Badge key="on" tone="ok" className="px-3 py-1 text-xs"><LiveDot className="mr-0.5" /> {t('Shift in progress')}</Badge>
          ) : (
            <Badge key="off" className="px-3 py-1 text-xs">{t('Off shift')}</Badge>
          )}
        </div>
      </div>

      {active.error && <ErrorNote message={active.error} />}

      <motion.div layout className="card relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand/[0.07] via-transparent to-transparent" />
        <div className="relative flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid flex-1 grid-cols-2 gap-5 sm:grid-cols-4 sm:gap-6">
            <div>
              <div className="label flex items-center gap-1.5"><Activity className="h-3 w-3" /> {t('Status')}</div>
              <div className="mt-2 text-lg font-semibold">{mine ? t('Active') : other ? t('Location busy') : t('Not started')}</div>
            </div>
            <div>
              <div className="label flex items-center gap-1.5"><Clock className="h-3 w-3" /> {t('Started')}</div>
              <div className="mt-2 text-lg font-semibold tabular notranslate">{mine ? formatTime(mine.start_time) : '—'}</div>
            </div>
            <div>
              <div className="label flex items-center gap-1.5"><Timer className="h-3 w-3" /> {t('Duration')}</div>
              <div className="mt-2 font-mono text-lg font-semibold tabular notranslate">{mine ? formatDuration(elapsed, true) : '—'}</div>
            </div>
            <div>
              <div className="label flex items-center gap-1.5"><Users className="h-3 w-3" /> {t('Shift total')}</div>
              <div className="mt-2 text-lg font-semibold tabular notranslate">{mine ? <AnimatedNumber value={shiftVisitors(mine)} /> : '—'}</div>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            {mine ? (
              <Button variant="danger" size="lg" icon={<Square className="h-4 w-4" />} onClick={() => setConfirmEnd(true)} disabled={busy}
                className="w-full border-danger bg-danger text-white shadow-[0_8px_24px_-8px_rgb(var(--danger)/0.6)] hover:bg-danger/90 sm:w-auto">
                {t('End shift')}
              </Button>
            ) : (
              <Button variant="success" size="lg" icon={<Play className="h-4 w-4" />} onClick={start} loading={busy}
                disabled={Boolean(other && settings?.single_shared_shift)} className="w-full sm:w-auto">
                {t('Start shift')}
              </Button>
            )}
          </div>
        </div>
        {!mine && other && (
          <div className="relative border-t bg-warn/[0.05] px-5 py-3 text-[13px] text-warn sm:px-6">
            {t('{name} has been on shift since {time}. A new shift can start once it is ended.', { name: other.employee_name, time: formatTime(other.start_time) })}
          </div>
        )}
      </motion.div>

      <div className="grid gap-4 md:grid-cols-2">
        <LiveCounterCard gender="male" active={Boolean(mine)} shiftCount={mine ? mine.male_count : active.data ? 0 : undefined}
          todayCount={today.data?.male} deviceOnline={online('MEN-001')} />
        <LiveCounterCard gender="female" active={Boolean(mine)} shiftCount={mine ? mine.female_count : active.data ? 0 : undefined}
          todayCount={today.data?.female} deviceOnline={online('WOMEN-001')} />
      </div>

      <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="label">{t('Total')}</div>
          <div className="mt-1 text-5xl font-semibold leading-none tracking-tight tabular notranslate sm:text-6xl">
            {mine ? <AnimatedNumber value={shiftVisitors(mine)} /> : 0}
          </div>
        </div>
        <div className="flex gap-5 text-sm">
          <div>
            <div className="text-xs text-male">{t('Men')}</div>
            <div className="mt-0.5 font-semibold tabular notranslate text-male">{formatNumber(mine?.male_count)}</div>
          </div>
          <div>
            <div className="text-xs text-female">{t('Women')}</div>
            <div className="mt-0.5 font-semibold tabular notranslate text-female">{formatNumber(mine?.female_count)}</div>
          </div>
        </div>
      </div>

      <Modal open={confirmEnd} onClose={() => setConfirmEnd(false)} title={t('Do you really want to end the shift?')}
        description={t('Counts are saved permanently and the shift can no longer receive new visitors.')}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmEnd(false)}>{t('Cancel')}</Button>
          <Button variant="danger" className="border-danger bg-danger text-white hover:bg-danger/90" onClick={end} loading={busy}>{t('End shift')}</Button>
        </>}>
        {mine && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-male/10 p-3"><div className="text-xs text-male">{t('Men')}</div><div className="mt-1 text-xl font-semibold tabular notranslate">{formatNumber(mine.male_count)}</div></div>
            <div className="rounded-xl bg-female/10 p-3"><div className="text-xs text-female">{t('Women')}</div><div className="mt-1 text-xl font-semibold tabular notranslate">{formatNumber(mine.female_count)}</div></div>
            <div className="rounded-xl bg-elevated p-3"><div className="text-xs text-subtle">{t('Total')}</div><div className="mt-1 text-xl font-semibold tabular notranslate">{formatNumber(shiftVisitors(mine))}</div></div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(summary)} onClose={() => setSummary(null)} title={t('Shift completed')} description={t('Great work — your shift has been saved.')}
        footer={<Button onClick={() => setSummary(null)}>{t('Done')}</Button>}>
        {summary && (
          <div className="space-y-3 text-sm">
            {[
              [t('Start'), formatTime(summary.start_time)],
              [t('End'), formatTime(summary.end_time)],
              [t('Duration'), formatDuration(summary.duration_seconds)],
              [t('Male visitors'), formatNumber(summary.male_count)],
              [t('Female visitors'), formatNumber(summary.female_count)],
              [t('Total visitors'), formatNumber(shiftVisitors(summary))],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-b pb-2 last:border-0"><span className="text-subtle">{k}</span><span className="font-semibold tabular notranslate">{v}</span></div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
