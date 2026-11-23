import { CalendarDays, Download, FileText, Printer } from 'lucide-react';
import { useState } from 'react';
import { backend } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { useSettings } from '@/hooks/useSettings';
import { formatDate, formatNumber, localeTag, pct, todayStr, toDayStr } from '@/lib/format';
import { useT } from '@/i18n/I18nProvider';
import { downloadCsv, toCsv } from '@/utils/csv';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Segmented } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Spinner';
import { ErrorNote, PageHeader } from '@/components/ui/misc';
import { shiftCsv } from './Shifts';

function Kpis({ items }: { items: [string, number, string?][] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, value, cls]) => (
        <div key={label} className="rounded-xl border bg-elevated/40 px-4 py-3">
          <div className="label">{label}</div>
          <div className={`mt-1 text-2xl font-semibold tabular notranslate ${cls ?? ''}`}>{formatNumber(value)}</div>
        </div>
      ))}
    </div>
  );
}

function DailyReportView() {
  const t = useT();
  const [day, setDay] = useState(todayStr());
  const report = useAsync(() => backend.getDailyReport(day), [day], { live: ['events', 'shifts'] });
  const shifts = useAsync(() => backend.listShifts({ from: day, to: day, limit: 500 }), [day], { live: ['shifts'] });
  const r = report.data;

  const exportCsv = () => {
    if (!r) return;
    const summary = toCsv(
      [{ k: t('Date'), v: r.date }, { k: t('Men'), v: r.male }, { k: t('Women'), v: r.female }, { k: t('Total'), v: r.total }, { k: t('Outside any shift'), v: r.unassigned }],
      [{ header: t('Metric'), value: (x) => x.k }, { header: t('Value'), value: (x) => x.v }],
    );
    const people = toCsv(r.employees, [
      { header: t('Employee'), value: (e) => e.name }, { header: t('Shifts'), value: (e) => e.shifts },
      { header: t('Men'), value: (e) => e.male }, { header: t('Women'), value: (e) => e.female }, { header: t('Total'), value: (e) => e.total },
    ]);
    const shiftRows = toCsv(shifts.data ?? [], shiftCsv());
    downloadCsv(`daily_report_${day}.csv`, [summary, '', people, '', shiftRows].join('\r\n'));
  };

  const controls = (
    <div className="no-print flex items-center gap-2">
      <Input type="date" value={day} max={todayStr()} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-9 w-[132px] sm:w-[150px]" />
      <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv} disabled={!r}>{t('CSV')}</Button>
      <Button variant="secondary" size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()}>{t('Print')}</Button>
    </div>
  );

  return (
    <Card>
      <CardHeader title={t('Daily report')} subtitle={formatDate(day)} icon={<CalendarDays className="h-4 w-4" />}
        action={<div className="hidden sm:block">{controls}</div>} />
      <div className="px-5 pt-4 sm:hidden">{controls}</div>
      <CardBody className="space-y-5">
        {report.error && <ErrorNote message={report.error} />}
        {!r ? <Skeleton className="h-24" /> : (
          <>
            <Kpis items={[[t('Total'), r.total], [t('Men'), r.male, 'text-male'], [t('Women'), r.female, 'text-female'], [t('Outside shifts'), r.unassigned]]} />
            {r.employees.length === 0 ? (
              <p className="py-8 text-center text-sm text-subtle">{t('No shifts on this day.')}</p>
            ) : (
              <>
                <div className="divide-y rounded-xl border sm:hidden">
                  {r.employees.map((e) => (
                    <div key={e.name} className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium">{e.name}</span>
                        <span className="text-xs text-subtle">{e.shifts} {t('shifts')}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                        <div><div className="label">{t('Men')}</div><div className="mt-1 font-semibold text-male">{formatNumber(e.male)}</div></div>
                        <div><div className="label">{t('Women')}</div><div className="mt-1 font-semibold text-female">{formatNumber(e.female)}</div></div>
                        <div><div className="label">{t('Total')}</div><div className="mt-1 font-semibold">{formatNumber(e.total)}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto rounded-xl border sm:block">
                  <table className="table-base">
                    <thead><tr><th>{t('Employee')}</th><th className="text-right">{t('Shifts')}</th><th className="text-right">{t('Men')}</th><th className="text-right">{t('Women')}</th><th className="text-right">{t('Total')}</th><th className="text-right">{t('Share')}</th></tr></thead>
                    <tbody>
                      {r.employees.map((e) => (
                        <tr key={e.name}>
                          <td className="font-medium">{e.name}</td>
                          <td className="text-right tabular notranslate">{e.shifts}</td>
                          <td className="text-right tabular notranslate text-male">{formatNumber(e.male)}</td>
                          <td className="text-right tabular notranslate text-female">{formatNumber(e.female)}</td>
                          <td className="text-right font-semibold tabular notranslate">{formatNumber(e.total)}</td>
                          <td className="text-right tabular notranslate text-muted">{pct(e.total, r.total)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function MonthlyReportView() {
  const t = useT();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const first = `${month}-01`;
  const lastDate = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0);
  const last = toDayStr(lastDate) > todayStr() ? todayStr() : toDayStr(lastDate);
  const daily = useAsync(() => backend.getDailyStats(first, last), [first, last], { live: ['events'] });
  const perf = useAsync(() => backend.getEmployeePerformance(first, last), [first, last]);
  const rows = daily.data ?? [];
  const male = rows.reduce((n, r) => n + r.male, 0);
  const female = rows.reduce((n, r) => n + r.female, 0);

  const exportCsv = () => {
    const days = toCsv(rows, [
      { header: t('Date'), value: (r) => r.day }, { header: t('Men'), value: (r) => r.male },
      { header: t('Women'), value: (r) => r.female }, { header: t('Total'), value: (r) => r.total },
    ]);
    const people = toCsv(perf.data ?? [], [
      { header: t('Employee'), value: (p) => p.full_name }, { header: t('Shifts'), value: (p) => p.shifts },
      { header: t('Hours'), value: (p) => p.hours }, { header: t('Men'), value: (p) => p.male },
      { header: t('Women'), value: (p) => p.female }, { header: t('Total'), value: (p) => p.total }, { header: t('Visitors per hour'), value: (p) => p.per_hour },
    ]);
    downloadCsv(`monthly_report_${month}.csv`, [days, '', people].join('\r\n'));
  };

  const controls = (
    <div className="no-print flex items-center gap-2">
      <Input type="month" value={month} max={todayStr().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 w-[132px] sm:w-[150px]" />
      <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv} disabled={!daily.data}>{t('CSV')}</Button>
      <Button variant="secondary" size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()}>{t('Print')}</Button>
    </div>
  );

  return (
    <Card>
      <CardHeader title={t('Monthly report')} subtitle={lastDate.toLocaleDateString(localeTag(), { month: 'long', year: 'numeric' })} icon={<FileText className="h-4 w-4" />}
        action={<div className="hidden sm:block">{controls}</div>} />
      <div className="px-5 pt-4 sm:hidden">{controls}</div>
      <CardBody className="space-y-5">
        {daily.error && <ErrorNote message={daily.error} />}
        {!daily.data ? <Skeleton className="h-24" /> : (
          <>
            <Kpis items={[[t('Total'), male + female], [t('Men'), male, 'text-male'], [t('Women'), female, 'text-female'], [t('Daily average'), Math.round((male + female) / Math.max(1, rows.length))]]} />
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="scrollbar-thin max-h-[420px] overflow-auto rounded-xl border">
                <table className="table-base">
                  <thead className="sticky top-0 bg-surface"><tr><th>{t('Date')}</th><th className="text-right">{t('Men')}</th><th className="text-right">{t('Women')}</th><th className="text-right">{t('Total')}</th></tr></thead>
                  <tbody>
                    {[...rows].reverse().map((r) => (
                      <tr key={r.day}>
                        <td>{formatDate(r.day)}</td>
                        <td className="text-right tabular notranslate text-male">{formatNumber(r.male)}</td>
                        <td className="text-right tabular notranslate text-female">{formatNumber(r.female)}</td>
                        <td className="text-right font-semibold tabular notranslate">{formatNumber(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="divide-y rounded-xl border lg:hidden">
                  {(perf.data ?? []).map((p) => (
                    <div key={p.employee_id} className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium">{p.full_name}</span>
                        <span className="text-xs text-subtle">{p.shifts} {t('shifts')}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                        <div><div className="label">{t('Hours')}</div><div className="mt-1 font-semibold tabular notranslate">{p.hours.toFixed(1)}</div></div>
                        <div><div className="label">{t('Visitors')}</div><div className="mt-1 font-semibold tabular notranslate">{formatNumber(p.total)}</div></div>
                        <div><div className="label">{t('Per hour')}</div><div className="mt-1 font-semibold tabular notranslate">{p.per_hour.toFixed(1)}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto rounded-xl border lg:block">
                  <table className="table-base">
                    <thead><tr><th>{t('Employee')}</th><th className="text-right">{t('Shifts')}</th><th className="text-right">{t('Hours')}</th><th className="text-right">{t('Visitors')}</th></tr></thead>
                    <tbody>
                      {(perf.data ?? []).map((p) => (
                        <tr key={p.employee_id}>
                          <td className="font-medium">{p.full_name}</td>
                          <td className="text-right tabular notranslate">{p.shifts}</td>
                          <td className="text-right tabular notranslate text-muted">{p.hours.toFixed(1)}</td>
                          <td className="text-right font-semibold tabular notranslate">{formatNumber(p.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export default function Reports() {
  const t = useT();
  const [tab, setTab] = useState<'daily' | 'monthly'>('daily');
  const { data: settings } = useSettings();
  return (
    <div className="space-y-6">
      <PageHeader title={t('Reports')} description={t('Exportable daily and monthly reports for {business}.', { business: settings?.business_name ?? t('Workspace') })}
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: 'daily', label: t('Daily') }, { value: 'monthly', label: t('Monthly') }]} />} />
      {tab === 'daily' ? <DailyReportView /> : <MonthlyReportView />}
      <p className="text-xs text-subtle">
        {t('Reports are generated on the server from the permanent event ledger.')}
        {settings?.telegram_enabled ? ` ${t('The daily report is also sent to Telegram at {hour}:00.', { hour: String(settings.daily_report_hour).padStart(2, '0') })}` : ''}
      </p>
    </div>
  );
}
