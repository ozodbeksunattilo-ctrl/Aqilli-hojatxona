import { CalendarRange, TrendingUp, Trophy, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { backend } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { addDays, formatNumber, formatShortDate, localeTag, todayStr } from '@/lib/format';
import { t as translate } from '@/i18n';
import { useT } from '@/i18n/I18nProvider';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Spinner';
import { ErrorNote, PageHeader, StatCard } from '@/components/ui/misc';
import { GenderDonut, GenderLegend, HorizontalBars, StackedBars, TrendChart } from '@/components/charts/Charts';
import type { DailyStat } from '@/types/domain';

type Range = '7' | '30' | '90' | '365';
type Grain = 'day' | 'week' | 'month';

const weekStart = (day: string) => {
  const d = new Date(`${day}T00:00:00`);
  return addDays(day, -((d.getDay() + 6) % 7)); // Monday
};

function bucket(rows: DailyStat[], grain: Grain) {
  if (grain === 'day') return rows.map((r) => ({ key: r.day, male: r.male, female: r.female }));
  const map = new Map<string, { key: string; male: number; female: number }>();
  for (const r of rows) {
    const key = grain === 'week' ? weekStart(r.day) : r.day.slice(0, 7);
    const b = map.get(key) ?? { key, male: 0, female: 0 };
    b.male += r.male;
    b.female += r.female;
    map.set(key, b);
  }
  return [...map.values()];
}

const keyLabel = (grain: Grain) => (k: string) =>
  grain === 'month'
    ? new Date(`${k}-01T00:00:00`).toLocaleDateString(localeTag(), { month: 'short', year: '2-digit' })
    : grain === 'week' ? translate('Week of {day}', { day: formatShortDate(k) }) : formatShortDate(k);

export default function Analytics() {
  const t = useT();
  const [range, setRange] = useState<Range>('30');
  const [grain, setGrain] = useState<Grain>('day');
  const to = todayStr();
  const from = addDays(to, -(Number(range) - 1));

  const daily = useAsync(() => backend.getDailyStats(from, to), [from, to], { live: ['events'] });
  const hourly = useAsync(() => backend.getHourlyDistribution(from, to), [from, to]);
  const perf = useAsync(() => backend.getEmployeePerformance(from, to), [from, to], { live: ['shifts'] });

  const rows = daily.data ?? [];
  const male = rows.reduce((n, r) => n + r.male, 0);
  const female = rows.reduce((n, r) => n + r.female, 0);
  const total = male + female;
  const best = rows.reduce<DailyStat | null>((b, r) => (!b || r.total > b.total ? r : b), null);
  const half = Math.floor(rows.length / 2);
  const prev = rows.slice(0, half).reduce((n, r) => n + r.total, 0);
  const curr = rows.slice(rows.length - half).reduce((n, r) => n + r.total, 0);
  const trend = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null;

  const series = useMemo(() => bucket(rows, grain), [rows, grain]);
  const effectiveGrain = grain;

  return (
    <div className="space-y-6">
      <PageHeader title={t('Analytics')} description={t('Visitor trends, gender comparison and employee performance.')}
        actions={
          <Segmented value={range} onChange={setRange} options={[
            { value: '7', label: t('7 days') }, { value: '30', label: t('30 days') }, { value: '90', label: t('90 days') }, { value: '365', label: t('12 months') },
          ]} />
        } />
      {daily.error && <ErrorNote message={daily.error} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t('Total visitors')} value={daily.data ? total : undefined} icon={<Users className="h-4 w-4" />} accent="brand"
          hint={`${formatShortDate(from)} – ${formatShortDate(to)}`} />
        <StatCard label={t('Daily average')} value={daily.data ? Math.round(total / Math.max(1, rows.length)) : undefined} icon={<CalendarRange className="h-4 w-4" />} index={1} />
        <StatCard label={t('Busiest day')} value={best ? best.total : daily.data ? 0 : undefined} icon={<Trophy className="h-4 w-4" />} accent="warn" index={2}
          hint={best && best.total > 0 ? formatShortDate(best.day) : undefined} />
        <StatCard label={t('Trend')} value={daily.data ? (trend === null ? '—' : `${trend > 0 ? '+' : ''}${trend}%`) : undefined}
          icon={<TrendingUp className="h-4 w-4" />} accent={trend !== null && trend < 0 ? 'female' : 'ok'} index={3} hint={t('Second half vs first half')} />
      </div>

      <Card>
        <CardHeader title={t('Visitor trend')} subtitle={t('Men vs women over time')}
          action={<Segmented value={grain} onChange={setGrain} options={[{ value: 'day', label: t('Daily') }, { value: 'week', label: t('Weekly') }, { value: 'month', label: t('Monthly') }]} />} />
        <CardBody>
          {daily.loading && !daily.data ? <Skeleton className="h-[300px]" /> : effectiveGrain === 'day'
            ? <TrendChart data={series} xKey="key" xFormatter={keyLabel(effectiveGrain)} height={300} />
            : <StackedBars data={series} xKey="key" xFormatter={keyLabel(effectiveGrain)} height={300} />}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t('Men vs women')} subtitle={t('Selected period')} />
          <CardBody className="space-y-4">
            <GenderDonut male={male} female={female} />
            <GenderLegend male={male} female={female} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t('Busiest hours')} subtitle={t('Total visitors per hour of day, selected period')} />
          <CardBody>
            {hourly.loading && !hourly.data ? <Skeleton className="h-[280px]" /> :
              <StackedBars data={hourly.data ?? []} xKey="hour" xFormatter={(h) => `${String(h).padStart(2, '0')}h`} height={280} />}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t('Employee performance')} subtitle={t('Visitors served per employee in shifts started during the period')} />
        <CardBody>
          {perf.loading && !perf.data ? <Skeleton className="h-48" /> : (
            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <HorizontalBars data={(perf.data ?? []).map((p) => ({ name: p.full_name, male: p.male, female: p.female }))} />
              <div className="scrollbar-thin overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>{t('Employee')}</th><th className="text-right">{t('Shifts')}</th><th className="text-right">{t('Visitors')}</th><th className="text-right">{t('Per hour')}</th></tr></thead>
                  <tbody>
                    {(perf.data ?? []).map((p, i) => (
                      <tr key={p.employee_id}>
                        <td className="font-medium"><span className="mr-2 text-subtle">{i + 1}.</span>{p.full_name}</td>
                        <td className="text-right tabular notranslate">{p.shifts}</td>
                        <td className="text-right font-semibold tabular notranslate">{formatNumber(p.total)}</td>
                        <td className="text-right tabular notranslate text-muted">{p.per_hour.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
