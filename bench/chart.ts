export interface Bar {
  label: string;
  color: string;
  value: number;
  text: string;
}

/**
 * Horizontal bars, one group per title, scaled to the largest value. Each bar but the best of its
 * group shows how many times worse it is.
 */
export function chart(
  groups: { title?: string; bars: Bar[] }[],
  { higherIsBetter = false, labelWidth = 96 }: { higherIsBetter?: boolean; labelWidth?: number } = {},
): string {
  const width = 640;
  const barX = labelWidth;
  const largest = Math.max(...groups.flatMap(({ bars }) => bars.map((bar) => bar.value)));
  const rows: string[] = [];
  let y = 0;
  for (const { title, bars } of groups) {
    if (title !== undefined) {
      rows.push(`<text class="title" x="0" y="${y + 11}">${title}</text>`);
      y += 30;
    }
    const values = bars.map((bar) => bar.value);
    const best = higherIsBetter ? Math.max(...values) : Math.min(...values);
    for (const { label, color, value, text } of bars) {
      const middle = y + 11;
      const barEnd = barX + Math.max(1, Math.round((value / largest) * (width - barX - 80)));
      rows.push(
        `<text x="${barX - 10}" y="${middle}" text-anchor="end">${label}</text>`,
        `<rect x="${barX}" y="${y}" width="${barEnd - barX}" height="22" rx="4" fill="${color}"/>`,
        `<text x="${barEnd + 8}" y="${middle}">${text}</text>`,
      );
      if (value !== best && barEnd - barX > 48) {
        const ratio = `${(higherIsBetter ? best / value : value / best).toFixed(2)}×`;
        rows.push(`<text class="ratio" x="${barEnd - 8}" y="${middle}" text-anchor="end">${ratio}</text>`);
      }
      y += 30;
    }
    y += title === undefined ? 0 : 10;
  }

  const height = y - (groups.at(-1)!.title === undefined ? 8 : 18);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text { font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; fill: #848d97; dominant-baseline: central; font-variant-numeric: tabular-nums }
    .ratio { font-size: 12px; fill: #fff }${groups.some(({ title }) => title !== undefined) ? "\n    .title { font-weight: 600 }" : ""}
  </style>
  ${rows.join("\n  ")}
</svg>
`;
}
