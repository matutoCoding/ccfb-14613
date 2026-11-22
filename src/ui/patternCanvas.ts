/**
 * 斑点渲染:红丹底色 + 接触区深浅随压力(间隙贴近程度)变化。
 * 横轴=齿宽方向, 纵轴=齿高方向(上=齿顶)。
 */
export interface PatternPaintOptions {
  nFace: number;
  nProfile: number;
  /** 间隙场(μm),用于颜色深浅;缺省则均匀着色 */
  gap?: Float32Array;
  /** 参考间隙(刚体贴近量),缺省取最小间隙 */
  approach?: number;
  paintThickness: number;
  /** 齿端应力集中标记(沿齿向),标红框 */
  edgeFlags?: Uint8Array;
  /** 叠加实测掩膜(照片对齐后), 0/1 */
  measuredMask?: Uint8Array;
  title?: string;
}

export function paintPattern(canvas: HTMLCanvasElement, mask: Uint8Array, opt: PatternPaintOptions): void {
  const { nFace: nF, nProfile: nP } = opt;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  // 金属底色
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#8f9499');
  grad.addColorStop(0.5, '#b9bec3');
  grad.addColorStop(1, '#878c91');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // 红丹涂层(薄涂,橙红)
  ctx.fillStyle = 'rgba(196, 69, 38, 0.35)';
  ctx.fillRect(0, 0, W, H);

  const cw = W / nF, ch = H / nP;
  const approach = opt.approach ?? 0;

  // 接触区:红丹被"蹭掉"露出亮色金属,边缘压力小处残留深红
  for (let i = 0; i < nF; i++) {
    for (let j = 0; j < nP; j++) {
      const idx = i * nP + j;
      if (!mask[idx]) continue;
      let intensity = 1; // 压力强度 0..1
      if (opt.gap) {
        const over = approach + opt.paintThickness - opt.gap[idx]; // 压入量
        intensity = Math.max(0.15, Math.min(1, over / Math.max(1e-6, opt.paintThickness)));
      }
      const x = i * cw, y = H - (j + 1) * ch; // 齿顶在上
      // 中心亮(磨掉红丹),压力越大越亮
      const r = Math.round(220 + 35 * intensity);
      const g = Math.round(170 + 60 * intensity);
      const b = Math.round(150 + 60 * intensity);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
      // 周边残红描边
      ctx.strokeStyle = `rgba(160, 40, 20, ${0.5 * (1 - intensity) + 0.2})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cw, ch);
    }
  }

  // 实测掩膜叠加(蓝色轮廓)
  if (opt.measuredMask) {
    ctx.strokeStyle = 'rgba(30, 90, 220, 0.9)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < nF; i++) {
      for (let j = 0; j < nP; j++) {
        const idx = i * nP + j;
        if (!opt.measuredMask[idx]) continue;
        // 只画边界
        const right = i + 1 < nF ? opt.measuredMask[idx + nP] : 0;
        const up = j + 1 < nP ? opt.measuredMask[idx + 1] : 0;
        if (!right) { ctx.beginPath(); ctx.moveTo((i + 1) * cw, H - (j + 1) * ch); ctx.lineTo((i + 1) * cw, H - j * ch); ctx.stroke(); }
        if (!up) { ctx.beginPath(); ctx.moveTo(i * cw, H - (j + 1) * ch); ctx.lineTo((i + 1) * cw, H - (j + 1) * ch); ctx.stroke(); }
      }
    }
  }

  // 齿端应力集中标红
  if (opt.edgeFlags) {
    ctx.strokeStyle = '#ff2222';
    ctx.lineWidth = 3;
    for (let i = 0; i < nF; i++) {
      if (!opt.edgeFlags[i]) continue;
      ctx.strokeRect(i * cw + 1, 1, cw - 2, H - 2);
    }
  }

  // 坐标标注
  ctx.fillStyle = '#222';
  ctx.font = '12px sans-serif';
  ctx.fillText('齿顶', 4, 14);
  ctx.fillText('齿根', 4, H - 6);
  ctx.fillText('齿宽方向 →', W / 2 - 30, H - 6);
  if (opt.title) ctx.fillText(opt.title, W - ctx.measureText(opt.title).width - 8, 14);
}

/** 传动误差曲线 */
export function paintTeCurve(
  canvas: HTMLCanvasElement,
  curves: { data: Float32Array; color: string; label: string }[],
): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, W, H);
  let lo = Infinity, hi = -Infinity;
  for (const c of curves) for (const v of c.data) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo) || hi - lo < 1e-9) { lo = -1; hi = 1; }
  const pad = (hi - lo) * 0.1;
  lo -= pad; hi += pad;
  const y = (v: number): number => H - ((v - lo) / (hi - lo)) * H;
  // 网格
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const yy = (H / 4) * k;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.fillText((hi - ((hi - lo) * k) / 4).toFixed(2), 4, yy + 12);
  }
  for (const c of curves) {
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    const n = c.data.length;
    for (let k = 0; k < n; k++) {
      const x = (k / (n - 1)) * W;
      if (k === 0) ctx.moveTo(x, y(c.data[k]));
      else ctx.lineTo(x, y(c.data[k]));
    }
    ctx.stroke();
    ctx.fillStyle = c.color;
    ctx.fillText(c.label, W - 160, 16 + 16 * curves.indexOf(c));
  }
  ctx.fillStyle = '#333';
  ctx.fillText('转角(一个基节周期)→', W / 2 - 60, H - 4);
  ctx.fillText('TE (μm)', 4, 12);
}
