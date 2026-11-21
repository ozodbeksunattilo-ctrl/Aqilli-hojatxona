import { CalendarDays, Download, FileText, Printer } from 'lucide-react';
import { useState } from 'react';
import { backend } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { useSettings } from '@/hooks/useSettings';
import { formatDate, formatNumber, pct, todayStr, toDayStr } from '@/lib/format';
import { downloadCsv, toCsv } from '@/utils/csv';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Segmented } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Spinner';
import { ErrorNote, PageHeader } from '@/components/ui/misc';
import { SHIFT_CSV } from './Shifts';

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
  const [day, setDay] = useState(todayStr());
  const report = useAsync(() => backend.getDailyReport(day), [day], { live: ['events', 'shifts'] });
  const shifts = useAsync(() => backend.listShifts({ from: day, to: day, limit: 500 }), [day], { live: ['shifts'] });
  const r = report.data;

  const exportCsv = () => {
    if (!r) return;
    const summary = toCsv(
      [{ k: 'Date', v: r.date }, { k: 'Men', v: r.male }, { k: 'Women', v: r.female }, { k: 'Total', v: r.total }, { k: 'Outside any shift', v: r.unassigned }],
      [{ header: 'Metric', value: (x) => x.k }, { header: 'Value', value: (x) => x.v }],
    );
    const people = toCsv(r.employees, [
      { header: 'Employee', value: (e) => e.name }, { header: 'Shifts', value: (e) => e.shifts },
      { header: 'Men', value: (e) => e.male }, { header: 'Women', value: (e) => e.female }, { header: 'Total', value: (e) => e.total },
    ]);
    const shiftRows = toCsv(shifts.data ?? [], SHIFT_CSV);
    downloadCsv(`daily_report_${day}.csv`, [summary, '', people, '', shiftRows].join('\r\n'));
  };

  return (
    <Card>
      <CardHeader title="Daily report" subtitle={formatDate(day)} icon={<CalendarDays className="h-4 w-4" />}
        action={
          <div className="no-print flex items-center gap-2">
            <Input type="date" value={day} max={todayStr()} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-9 w-[150px]" />
            <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv} disabled={!r}>CSV</Button>
            <Button variant="secondary" size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()}>Print</Button>
          </div>
        } />
      <CardBody className="space-y-5">
        {report.error && <ErrorNote message={report.error} />}
        {!r ? <Skeleton className="h-24" /> : (
          <>
            <Kpis items={[['Total', r.total], ['Men', r.male, 'text-male'], ['Women', r.female, 'text-female'], ['Outside shifts', r.unassigned]]} />
            <div className="overflow-x-auto rounded-xl border">
              <table className="table-base">
                <thead><tr><th>Employee</th><th className="text-right">Shifts</th><th className="text-right">Men</th><th className="text-right">Women</th><th className="text-right">Total</th><th className="text-right">Share</th></tr></thead>
                <tbody>
                  {r.employees.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-subtle">No shifts on this day.</td></tr>}
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
      </CardBody>
    </Card>
  );
}

function MonthlyReportView() {
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
      { header: 'Date', value: (r) => r.day }, { header: 'Men', value: (r) => r.male },
      { header: 'Women', value: (r) => r.female }, { header: 'Total', value: (r) => r.total },
    ]);
    const people = toCsv(perf.data ?? [], [
      { header: 'Employee', value: (p) => p.full_name }, { header: 'Shifts', value: (p) => p.shifts },
      { header: 'Hours', value: (p) => p.hours }, { header: 'Men', value: (p) => p.male },
      { header: 'Women', value: (p) => p.female }, { header: 'Total', value: (p) => p.total }, { header: 'Visitors per hour', value: (p) => p.per_hour },
    ]);
    downloadCsv(`monthly_report_${month}.csv`, [days, '', people].join('\r\n'));
  };

  return (
    <Card>
      <CardHeader title="Monthly report" subtitle={lastDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} icon={<FileText className="h-4 w-4" />}
        action={
          <div className="no-print flex items-center gap-2">
            <Input type="month" value={month} max={todayStr().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 w-[150px]" />
            <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv} disabled={!daily.data}>CSV</Button>
            <Button variant="secondary" size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()}>Print</Button>
          </div>
        } />
      <CardBody className="space-y-5">
        {daily.error && <ErrorNote message={daily.error} />}
        {!daily.data ? <Skeleton className="h-24" /> : (
          <>
            <Kpis items={[['Total', male + female], ['Men', male, 'text-male'], ['Women', female, 'text-female'], ['Daily average', Math.round((male + female) / Math.max(1, rows.length))]]} />
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="scrollbar-thin max-h-[420px] overflow-auto rounded-xl border">
                <table className="table-base">
                  <thead className="sticky top-0 bg-surface"><tr><th>Date</th><th className="text-right">Men</th><th className="text-right">Women</th><th className="text-right">Total</th></tr></thead>
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
              <div className="overflow-x-auto rounded-xl border">
                <table className="table-base">
                  <thead><tr><th>Employee</th><th className="text-right">Shifts</th><th className="text-right">Hours</th><th className="text-right">Visitors</th></tr></thead>
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
          </>
        )}
      </CardBody>
    </Card>
  );
}

export default function Reports() {
  const [tab, setTab] = useState<'daily' | 'monthly'>('daily');
  const { data: settings } = useSettings();
  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description={`Exportable daily and monthly reports for ${settings?.business_name ?? 'your business'}.`}
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: 'daily', label: 'Daily' }, { value: 'monthly', label: 'Monthly' }]} />} />
      {tab === 'daily' ? <DailyReportView /> : <MonthlyReportView />}
      <p className="text-xs text-subtle">
        Reports are generated on the server from the permanent event ledger.
        {settings?.telegram_enabled ? ` The daily report is also sent to Telegram at ${String(settings.daily_report_hour).padStart(2, '0')}:00.` : ''}
      </p>
    </div>
  );
}
