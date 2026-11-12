import { ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as S from '../lib/stats';
import { ar, shortDate } from '../lib/format';
import type { Entry } from '../lib/types';

type Weekly = { week_start: string; avg_weight: number | null; is_complete: boolean };
const ts = (d: string) => Date.parse(`${d}T12:00:00Z`);

/** Daily weights as faint dots, weekly average as a bold line, 4-week target dashed (plan §7.3). */
export default function WeightChart({ entries, weekly, target, fromDay, toDay }: {
  entries: Entry[]; weekly: Weekly[]; target: { date: string; target: number }[]; fromDay: string; toDay: string;
}) {
  const inRange = (d: string) => d >= fromDay && d <= toDay;
  const daily = entries.filter((e) => inRange(e.date)).map((e) => ({ x: ts(e.date), daily: e.weight }));
  // Weekly average plotted mid-week (Wednesday of a Sun–Sat week).
  const avg = weekly
    .filter((w) => w.avg_weight != null && inRange(S.addDays(w.week_start, 3)))
    .map((w) => ({ x: ts(S.addDays(w.week_start, 3)), avg: w.avg_weight, complete: w.is_complete }));
  const tgt = target.filter((t) => t.date <= toDay).map((t) => ({ x: ts(t.date < fromDay ? fromDay : t.date), target: t.target }));

  const values = [...daily.map((d) => d.daily), ...avg.map((a) => a.avg as number), ...tgt.map((t) => t.target)];
  if (values.length === 0) return <p className="muted center">ما فيه وزنات في هالفترة.</p>;
  const lo = Math.floor(Math.min(...values) - 1);
  const hi = Math.ceil(Math.max(...values) + 1);

  return (
    // Time runs right→left to match the RTL app (newest on the left), y-axis on the right.
    <div style={{ width: '100%', height: 260, direction: 'ltr' }}>
      <ResponsiveContainer>
        <ComposedChart margin={{ top: 8, right: -18, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="x" type="number" scale="time" domain={[ts(fromDay), ts(toDay)]} reversed
            tickFormatter={(v) => shortDate(new Date(v).toISOString().slice(0, 10))}
            tick={{ fontSize: 11, fill: 'var(--ink-3)' }} tickLine={false} axisLine={false} minTickGap={24}
          />
          <YAxis orientation="right" domain={[lo, hi]} tick={{ fontSize: 11, fill: 'var(--ink-3)' }} tickFormatter={(v) => ar(v, 0)} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--ink)' }}
            labelFormatter={(v) => shortDate(new Date(Number(v)).toISOString().slice(0, 10))}
            formatter={(v: number, name: string) => [ar(v), name === 'avg' ? 'متوسط الأسبوع' : name === 'daily' ? 'الوزن' : 'الهدف']}
          />
          <Line data={tgt} dataKey="target" stroke="var(--ink-3)" strokeDasharray="6 5" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          <Scatter data={daily} dataKey="daily" fill="var(--ink)" fillOpacity={0.25} isAnimationActive={false} />
          <Line data={avg} dataKey="avg" stroke="var(--accent)" strokeWidth={3} dot={{ r: 3, fill: 'var(--accent)' }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
