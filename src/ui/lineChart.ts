/**
 * 轻量折线图(Canvas): 传动误差曲线、修形前后叠加
 */
export interface LineSeries {
  label: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
}

export class LineChart {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(width = 620, height = 320) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width * devicePixelRatio;
    this.canvas.height = height * devicePixelRatio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.className = 'line-chart';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  render(series: LineSeries[], opts: { xLabel?: string; yLabel?: string; title?: string } = {}): void {
    const ctx = this.ctx;
    const W = this.canvas.width / devicePixelRatio;
    const H = this.canvas.height / devicePixelRatio;
    const m = { l: 64, r: 18, t: 36, b: 44 };
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = getCss('--panel', '#1b1f27');
    ctx.fillRect(0, 0, W, H);
    if (opts.title) {
      ctx.fillStyle = getCss('--fg', '#e6e6e6');
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(opts.title, m.l, 22);
    }
    const allX = series.flatMap((s) => s.points.map((p) => p.x));
    const allY = series.flatMap((s) => s.points.map((p) => p.y));
    if (!allX.length) return;
    const xMin = Math.min(...allX);
    const xMax = Math.max(...allX);
    let yMin = Math.min(...allY);
    let yMax = Math.max(...allY);
    if (Math.abs(yMax - yMin) < 1e-15) {
      yMin -= 1e-7;
      yMax += 1e-7;
    }
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;
    const px = (x: number): number => m.l + ((x - xMin) / (xMax - xMin)) * (W - m.l - m.r);
    const py = (y: number): number => m.t + (1 - (y - yMin) / (yMax - yMin)) * (H - m.t - m.b);

    // 网格与零轴
    ctx.strokeStyle = getCss('--border', '#3a4150');
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = getCss('--fg-dim', '#9aa3b2');
    for (let g = 0; g <= 4; g++) {
      const y = m.t + (g / 4) * (H - m.t - m.b);
      ctx.beginPath();
      ctx.moveTo(m.l, y);
      ctx.lineTo(W - m.r, y);
      ctx.stroke();
      const val = yMax - (g / 4) * (yMax - yMin);
      ctx.textAlign = 'right';
      ctx.fillText(formatTe(val), m.l - 6, y + 3);
    }
    // 零线
    if (yMin < 0 && yMax > 0) {
      ctx.strokeStyle = getCss('--accent', '#4ea1ff');
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(m.l, py(0));
      ctx.lineTo(W - m.r, py(0));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 曲线
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.8;
      ctx.setLineDash(s.dashed ? [5, 4] : []);
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const x = px(p.x);
        const y = py(p.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 轴标签
    ctx.fillStyle = getCss('--fg-dim', '#9aa3b2');
    ctx.textAlign = 'center';
    ctx.fillText(opts.xLabel ?? 'x', (W + m.l - m.r) / 2, H - 12);
    ctx.save();
    ctx.translate(16, (H + m.t - m.b) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel ?? 'y', 0, 0);
    ctx.restore();

    // 图例
    ctx.textAlign = 'left';
    let lx = m.l;
    series.forEach((s) => {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, 30, 18, 3);
      ctx.fillStyle = getCss('--fg', '#e6e6e6');
      ctx.fillText(s.label, lx + 24, 34);
      lx += 24 + ctx.measureText(s.label).width + 22;
    });
  }
}

function formatTe(v: number): string {
  const urad = v * 1e6;
  if (Math.abs(urad) >= 1) return urad.toFixed(1) + 'μrad';
  return (v * 1e9).toFixed(1) + 'nrad';
}

function getCss(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v?.trim() || fallback;
}
