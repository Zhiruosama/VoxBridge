// Native chrome and DOM surfaces share one clock. Text switches contrast at the
// midpoint instead of crossfading opposite text colors into unreadable grey.
const surfaces = [
  '--bg',
  '--side',
  '--raised',
  '--hover',
  '--border',
  '--menu',
  '--menu-hover',
  '--composer-border',
  '--composer-focus-border',
  '--composer-shadow-near',
  '--composer-shadow-far',
];
const foregrounds = [
  '--text',
  '--muted',
  '--faint',
  '--accent',
  '--accent-text',
  '--good',
  '--danger',
  '--focus',
];
const tokens = [...surfaces, ...foregrounds];
type Color = [number, number, number, number];
function parseColor(text: string): Color | null {
  const hex = text.trim().match(/^#([\da-f]{6})$/i);
  if (hex)
    return [
      parseInt(hex[1].slice(0, 2), 16),
      parseInt(hex[1].slice(2, 4), 16),
      parseInt(hex[1].slice(4, 6), 16),
      1,
    ];
  const rgb = text.trim().match(/^rgba?\((.*)\)$/);
  if (!rgb) return null;
  const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const values = parts.map(
    (part, index) => parseFloat(part) * (part.endsWith('%') ? (index === 3 ? 0.01 : 2.55) : 1),
  );
  if (!values.every(Number.isFinite)) return null;
  return [values[0], values[1], values[2], values[3] ?? 1];
}
export class ThemeSurface {
  private original: Map<string, { value: string; priority: string }> | null = null;
  constructor(private root: HTMLElement) {}
  prepare(next: 'light' | 'dark'): (progress: number) => void {
    const read = () => {
      const style = getComputedStyle(this.root);
      return new Map(tokens.map((token) => [token, style.getPropertyValue(token)]));
    };
    const from = read();
    if (!this.original)
      this.original = new Map(
        tokens.map((token) => [
          token,
          {
            value: this.root.style.getPropertyValue(token),
            priority: this.root.style.getPropertyPriority(token),
          },
        ]),
      );
    this.restore();
    this.root.dataset.theme = next;
    const to = read();
    const pairs = surfaces.map((token) => ({
      token,
      from: parseColor(from.get(token) ?? ''),
      to: parseColor(to.get(token) ?? ''),
    }));
    const paint = (progress: number) => {
      const p = Math.max(0, Math.min(1, progress));
      for (const { token, from: start, to: end } of pairs) {
        if (!start || !end) continue;
        const mix = (i: number) => start[i] + (end[i] - start[i]) * p;
        this.root.style.setProperty(
          token,
          `rgba(${Math.round(mix(0))}, ${Math.round(mix(1))}, ${Math.round(mix(2))}, ${mix(3)})`,
        );
      }
      for (const token of foregrounds)
        this.root.style.setProperty(token, (p < 0.5 ? from : to).get(token) ?? '');
    };
    paint(0);
    return paint;
  }
  private restore() {
    for (const [token, { value, priority }] of this.original ?? []) {
      if (value) this.root.style.setProperty(token, value, priority);
      else this.root.style.removeProperty(token);
    }
  }
  finish() {
    this.restore();
    this.original = null;
  }
}
