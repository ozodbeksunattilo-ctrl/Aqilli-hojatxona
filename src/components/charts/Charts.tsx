import { useEffect, useState } from 'react';
import { Mars, Venus } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { useTheme } from '@/hooks/useTheme';
import { formatNumber, pct } from '@/lib/format';
import { useT } from '@/i18n/I18nProvider';

function readColors() {
  const css = getComputedStyle(document.documentElement);
  const c = (name: string) => `rgb(${css.getPropertyValue(`--${name}`).trim().replace(/ /g, ',')})`;
  return { male: c('male'), female: c('female'), brand: c('brand'), grid: c('line'), text: c('subtle'), fg: c('fg'), surface: c('surface') };
}

/** Resolves the CSS design tokens into concrete colors (SVG attributes can't use var()). */
export function useChartColors() {
  const { resolved } = useTheme();
  const [colors, setColors] = useState(readColors);
  useEffect(() => setColors(readColors()), [resolved]);
  return colors;
}

function ChartTooltip({ active, payload, label, labelFormatter }: TooltipProps<number, string> & { labelFormatter?: (l: string) => string }) {
  const t = useT();
  if (!active || !payload?.length) return null;
  const total = payload.reduce((n, p) => n + Number(p.value ?? 0), 0);
  return (
    <div className="card min-w-[160px] bg-surface/95 px-3.5 py-3 text-xs shadow-xl backdrop-blur">
      <div className="mb-2 font-medium text-fg">{labelFormatter ? labelFormatter(String(label)) : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey as string} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-2 text-subtle"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}</span>
          <span className="font-medium tabular notranslate text-fg">{formatNumber(Number(p.value))}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="mt-1.5 flex justify-between border-t pt-1.5"><span className="text-subtle">{t('Total')}</span><span className="font-semibold tabular notranslate text-fg">{formatNumber(total)}</span></div>
      )}
    </div>
  );
}

const axis = (color: string) => ({ stroke: color, fontSize: 11, tickLine: false, axisLine: false });
const compact = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v));

export function TrendChart({ data, xKey, xFormatter, height = 280 }: {
  data: { male: number; female: number }[];
  xKey: string;
  xFormatter?: (v: string) => string;
  height?: number;
}) {
  const c = useChartColors();
  const t = useT();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <defs>
          {(['male', 'female'] as const).map((k) => (
            <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c[k]} stopOpacity={0.35} />
              <stop offset="100%" stopColor={c[k]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke={c.grid} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} {...axis(c.text)} tickFormatter={xFormatter} minTickGap={24} />
        <YAxis {...axis(c.text)} allowDecimals={false} width={44} tickFormatter={compact} />
        <Tooltip content={<ChartTooltip labelFormatter={xFormatter} />} cursor={{ stroke: c.grid }} />
        <Area type="monotone" dataKey="male" name={t('Men')} stroke={c.male} strokeWidth={2} fill="url(#g-male)" animationDuration={700} />
        <Area type="monotone" dataKey="female" name={t('Women')} stroke={c.female} strokeWidth={2} fill="url(#g-female)" animationDuration={700} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function StackedBars({ data, xKey, xFormatter, height = 260 }: {
  data: { male: number; female: number }[];
  xKey: string;
  xFormatter?: (v: string) => string;
  height?: number;
}) {
  const c = useChartColors();
  const t = useT();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={c.grid} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} {...axis(c.text)} tickFormatter={xFormatter} minTickGap={8} />
        <YAxis {...axis(c.text)} allowDecimals={false} width={44} tickFormatter={compact} />
        <Tooltip content={<ChartTooltip labelFormatter={xFormatter} />} cursor={{ fill: c.grid, opacity: 0.4 }} />
        <Bar dataKey="male" name={t('Men')} stackId="a" fill={c.male} animationDuration={700} />
        <Bar dataKey="female" name={t('Women')} stackId="a" fill={c.female} radius={[4, 4, 0, 0]} animationDuration={700} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GenderDonut({ male, female, height = 220 }: { male: number; female: number; height?: number }) {
  const c = useChartColors();
  const t = useT();
  const total = male + female;
  const data = total > 0 ? [{ name: t('Men'), value: male }, { name: t('Women'), value: female }] : [{ name: t('None'), value: 1 }];
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius="70%" outerRadius="92%" paddingAngle={total > 0 ? 3 : 0} stroke="none" startAngle={90} endAngle={-270} animationDuration={800}>
            {total > 0 ? [<Cell key="m" fill={c.male} />, <Cell key="f" fill={c.female} />] : <Cell fill={c.grid} />}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-semibold tracking-tight tabular notranslate">{formatNumber(total)}</div>
        <div className="text-xs text-subtle">{t('visitors')}</div>
      </div>
      <div className="sr-only">{t('Men {male}%, women {female}%', { male: pct(male, total), female: pct(female, total) })}</div>
    </div>
  );
}

export function GenderLegend({ male, female }: { male: number; female: number }) {
  const t = useT();
  const total = male + female;
  return (
    <div className="grid grid-cols-2 gap-3">
      {[
        { label: t('Men'), value: male, icon: <Mars className="h-3.5 w-3.5 text-male" /> },
        { label: t('Women'), value: female, icon: <Venus className="h-3.5 w-3.5 text-female" /> },
      ].map((x) => (
        <div key={x.label} className="rounded-xl border bg-elevated/40 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-subtle">{x.icon}{x.label}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg font-semibold tabular notranslate">{formatNumber(x.value)}</span>
            <span className="text-xs text-subtle">{pct(x.value, total)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function HorizontalBars({ data, height }: { data: { name: string; male: number; female: number }[]; height?: number }) {
  const c = useChartColors();
  const t = useT();
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(160, data.length * 52)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid horizontal={false} stroke={c.grid} strokeDasharray="3 3" />
        <XAxis type="number" {...axis(c.text)} allowDecimals={false} tickFormatter={compact} />
        <YAxis type="category" dataKey="name" {...axis(c.text)} width={120} tick={{ fill: c.fg, fontSize: 12 }} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: c.grid, opacity: 0.4 }} />
        <Bar dataKey="male" name={t('Men')} stackId="a" fill={c.male} animationDuration={700} />
        <Bar dataKey="female" name={t('Women')} stackId="a" fill={c.female} radius={[0, 4, 4, 0]} animationDuration={700} />
      </BarChart>
    </ResponsiveContainer>
  );
}
