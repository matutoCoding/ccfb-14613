/**
 * 二维场 Canvas 渲染器
 * - 红丹模式: 灰黑齿面底色 + 红丹色(深浅随接触强度/压力)
 * - 间隙模式: 蓝-白-红发散色标
 * 支持工作面/非工作面切换、齿端应力集中标红叠加
 */
export interface HeatmapOptions {
  title: string;
  mode: 'redlead' | 'clearance' | 'stress';
  xLabel: string;
  yLabel: string;
  /** 应力集中格点(stress 模式叠加描边) */
  redZones?: number[];
  /** 自定义值域 */
  min?: number;
  max?: number;
  showColorbar?: boolean;
}

export class HeatmapView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(width = 560, height = 420) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width * devicePixelRatio;
    this.canvas.height = height * devicePixelRatio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.className = 'heatmap';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  render(
    field: Float64Array | number[],
    nS: number,
    nZ: number,
    sAxis: ArrayLike<number>,
    zAxis: ArrayLike<number>,
    opts: HeatmapOptions,
  ): void {
    const ctx = this.ctx;
    const W = this.canvas.width / devicePixelRatio;
    const H = this.canvas.height / devicePixelRatio;
    const margin = { l: 56, r: opts.showColorbar === false ? 16 : 84, t: 40, b: 48 };
    const pw = W - margin.l - margin.r;
    const ph = H - margin.t - margin.b;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = getCss('--panel', '#1b1f27');
    ctx.fillRect(0, 0, W, H);

    // 标题
    ctx.fillStyle = getCss('--fg', '#e6e6e6');
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(opts.title, margin.l, 22);

    let min = opts.min;
    let max = opts.max;
    if (min === undefined || max === undefined) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of field) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      min = lo;
      max = hi;
      if (opts.mode === 'redlead' || opts.mode === 'stress') {
        min = 0;
        max = Math.max(hi, 1e-9);
      }
      if (Math.abs(max - min) < 1e-15) {
        max = min + 1;
      }
    }

    const cw = pw / nZ;
    const ch = ph / nS;
    // 齿面底色
    ctx.fillStyle = opts.mode === 'redlead' ? '#2a2520' : '#141820';
    ctx.fillRect(margin.l, margin.t, pw, ph);

    for (let i = 0; i < nS; i++) {
      for (let j = 0; j < nZ; j++) {
        const v = field[i * nZ + j];
        const t01 = (v - min!) / (max! - min!);
        ctx.fillStyle = this.color(t01, opts.mode, v);
        if (opts.mode === 'redlead' && v <= 0.02) continue;
        ctx.fillRect(margin.l + j * cw, margin.t + i * ch, cw + 0.5, ch + 0.5);
      }
    }

    // 应力集中红圈
    if (opts.redZones) {
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 1.5;
      for (const idx of opts.redZones) {
        const i = Math.floor(idx / nZ);
        const j = idx % nZ;
        ctx.strokeRect(margin.l + j * cw, margin.t + i * ch, cw, ch);
      }
    }

    // 边框与网格线
    ctx.strokeStyle = getCss('--border', '#3a4150');
    ctx.lineWidth = 1;
    ctx.strokeRect(margin.l, margin.t, pw, ph);

    // 坐标轴标注
    ctx.fillStyle = getCss('--fg-dim', '#9aa3b2');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(opts.xLabel, margin.l + pw / 2, H - 14);
    ctx.save();
    ctx.translate(16, margin.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel, 0, 0);
    ctx.restore();

    // 刻度值(两端与中点)
    ctx.textAlign = 'center';
    for (const j of [0, Math.floor(nZ / 2), nZ - 1]) {
      const x = margin.l + (j / (nZ - 1)) * pw;
      ctx.fillText(zAxis[j].toFixed(1), x, margin.t + ph + 16);
    }
    ctx.textAlign = 'right';
    for (const i of [0, Math.floor(nS / 2), nS - 1]) {
      const y = margin.t + (i / (nS - 1)) * ph + 4;
      ctx.fillText(sAxis[i].toFixed(2), margin.l - 6, y);
    }

    // 色标
    if (opts.showColorbar !== false) {
      const cbX = margin.l + pw + 18;
      const cbW = 14;
      const bands = 48;
      for (let b = 0; b < bands; b++) {
        const t01 = b / (bands - 1);
        ctx.fillStyle = this.color(t01, opts.mode, min! + t01 * (max! - min!));
        ctx.fillRect(cbX, margin.t + ph - (b / bands) * ph, cbW, ph / bands + 1);
      }
      ctx.strokeStyle = getCss('--border', '#3a4150');
      ctx.strokeRect(cbX, margin.t, cbW, ph);
      ctx.fillStyle = getCss('--fg-dim', '#9aa3b2');
      ctx.textAlign = 'left';
      ctx.fillText(formatVal(max!), cbX + cbW + 4, margin.t + 4);
      ctx.fillText(formatVal((min! + max!) / 2), cbX + cbW + 4, margin.t + ph / 2);
      ctx.fillText(formatVal(min!), cbX + cbW + 4, margin.t + ph);
    }
  }

  private color(t: number, mode: HeatmapOptions['mode'], raw: number): string {
    const x = Math.min(1, Math.max(0, t));
    if (mode === 'redlead') {
      // 灰黑底 -> 暗红 -> 鲜红 -> 橙红高光, 模拟红丹由薄到厚
      if (raw <= 0.02) return '#2a2520';
      const r = Math.round(60 + 195 * x);
      const g = Math.round(20 + 40 * (1 - x));
      const b = Math.round(16 + 20 * (1 - x));
      return `rgb(${r},${g},${b})`;
    }
    if (mode === 'stress') {
      // 蓝(低压) -> 青 -> 黄 -> 红(高压)
      return jetColor(x);
    }
    // clearance: 蓝(负/干涉) -> 白(零) -> 红(正/分离)
    return diverging(x);
  }
}

function jetColor(t: number): string {
  const r = Math.round(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 3))));
  const g = Math.round(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 2))));
  const b = Math.round(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 1))));
  return `rgb(${r},${g},${b})`;
}

function diverging(t: number): string {
  // t=0 蓝, 0.5 白, 1 红
  if (t < 0.5) {
    const k = t / 0.5;
    return `rgb(${Math.round(40 + 215 * k)},${Math.round(60 + 195 * k)},${Math.round(180 + 75 * k)})`;
  }
  const k = (t - 0.5) / 0.5;
  return `rgb(255,${Math.round(255 - 195 * k)},${Math.round(255 - 215 * k)})`;
}

function formatVal(v: number): string {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(2);
  if (abs >= 0.001) return (v * 1000).toFixed(1) + 'μm';
  return v.toExponential(1);
}

function getCss(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v?.trim() || fallback;
}
