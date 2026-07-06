import { useState } from 'react';

/**
 * Dependency-free SVG bar chart following the dataviz mark specs:
 * thin bars with 4px rounded data-ends, hairline gridlines, muted axis text,
 * per-mark hover tooltip, single-hue series (values are one measure).
 */
export interface BarDatum {
  label: string;
  value: number;
  /** Optional pre-formatted value for tooltip/direct label. */
  display?: string;
}

export function BarChart({
  data,
  height = 180,
  horizontal = false,
  formatValue = (v) => String(v),
}: {
  data: BarDatum[];
  height?: number;
  horizontal?: boolean;
  formatValue?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) {
    return <p className="p-6 text-center text-sm text-[var(--ink-muted)]">No data yet</p>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);

  if (horizontal) {
    return (
      <div className="space-y-2 p-1" role="img" aria-label="Bar chart">
        {data.map((d, i) => (
          <div
            key={d.label}
            className="group grid grid-cols-[8rem_1fr_auto] items-center gap-2 text-sm"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="truncate text-[var(--ink-2)]" title={d.label}>{d.label}</span>
            <div className="h-4 rounded-r" style={{ background: 'transparent' }}>
              <div
                className="h-4 rounded-r transition-opacity"
                style={{
                  width: `${Math.max((d.value / max) * 100, 1)}%`,
                  background: 'var(--series-1)',
                  opacity: hover === null || hover === i ? 1 : 0.45,
                }}
              />
            </div>
            <span className="tabular-nums text-xs text-[var(--ink-2)]">
              {d.display ?? formatValue(d.value)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const W = 640;
  const H = height;
  const pad = { top: 12, right: 8, bottom: 24, left: 8 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const band = plotW / data.length;
  const barW = Math.min(band * 0.55, 48);
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bar chart">
        {/* hairline gridlines */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={pad.left}
            x2={W - pad.right}
            y1={y(max * f)}
            y2={y(max * f)}
            stroke="var(--grid)"
            strokeWidth="1"
          />
        ))}
        {/* baseline */}
        <line
          x1={pad.left} x2={W - pad.right} y1={pad.top + plotH} y2={pad.top + plotH}
          stroke="var(--baseline)" strokeWidth="1"
        />
        {data.map((d, i) => {
          const x = pad.left + i * band + (band - barW) / 2;
          const barY = y(d.value);
          const h = Math.max(pad.top + plotH - barY, d.value > 0 ? 2 : 0);
          return (
            <g key={d.label}>
              {/* generous hit target */}
              <rect
                x={pad.left + i * band} y={pad.top} width={band} height={plotH + pad.bottom}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              <rect
                x={x} y={barY} width={barW} height={h}
                rx={4} ry={4}
                fill="var(--series-1)"
                opacity={hover === null || hover === i ? 1 : 0.45}
                style={{ pointerEvents: 'none' }}
              />
              {/* square off the bottom corners: bars anchor to the baseline */}
              {h > 4 && (
                <rect x={x} y={pad.top + plotH - 4} width={barW} height={4} fill="var(--series-1)"
                  opacity={hover === null || hover === i ? 1 : 0.45} style={{ pointerEvents: 'none' }} />
              )}
              <text
                x={pad.left + i * band + band / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize="11"
                fill="var(--ink-muted)"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-md border border-[var(--grid)] bg-[var(--surface-1)] px-2 py-1 text-xs shadow"
          style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
          role="status"
        >
          <span className="font-medium">{data[hover].label}</span>{' '}
          <span className="tabular-nums text-[var(--ink-2)]">
            {data[hover].display ?? formatValue(data[hover].value)}
          </span>
        </div>
      )}
    </div>
  );
}

export function StatTile({ label, value, sub, subTone }: {
  label: string;
  value: string;
  sub?: string;
  subTone?: 'good' | 'bad';
}) {
  return (
    <div className="rounded-xl border border-[var(--grid)] bg-[var(--surface-1)] p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && (
        <p
          className="mt-0.5 text-xs"
          style={{
            color: subTone === 'good' ? 'var(--delta-good)' : subTone === 'bad' ? 'var(--status-critical)' : 'var(--ink-muted)',
          }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
