import { ar } from '../lib/format';

export default function Ladder({ ladder }: { ladder: { steps: number[]; reached: number[]; next: number | null; remaining_to_next: number | null } }) {
  if (!ladder.steps.length) return <p className="muted">حدد وزن البداية والهدف عشان يطلع السلّم.</p>;
  const max = ladder.steps[0];
  const min = ladder.steps[ladder.steps.length - 1];
  return (
    <div className="ladder">
      {ladder.steps.map((s) => {
        const done = ladder.reached.includes(s);
        const next = s === ladder.next;
        const width = 30 + ((s - min) / Math.max(1, max - min)) * 70;
        return (
          <div key={s} className={`step ${done ? 'done' : ''} ${next ? 'next' : ''}`}>
            <span className="v">{ar(s)}</span>
            <span className="track"><span className="bar" style={{ width: `${width}%` }} /></span>
            <span className="status small">
              {done ? '✓' : next && ladder.remaining_to_next != null && ladder.remaining_to_next > 0 ? `باقي ${ar(ladder.remaining_to_next)}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
