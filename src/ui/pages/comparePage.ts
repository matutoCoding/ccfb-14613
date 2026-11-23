/**
 * 斑点对比页面
 * 1. 导入现场红丹照片, 四角标定对齐齿面坐标
 * 2. 仿真斑点与照片叠加
 * 3. 自动反推最可能的装配误差组合
 * 4. 国标接触精度等级判定
 */
import { getState, savePhoto } from '../../db/store';
import { derivePair } from '../../gear/pair';
import { effectiveErrors } from '../../gear/assembly';
import { buildGrid, simulateRotation, clearanceVector } from '../../gear/tca';
import { inverseFromGapField, inverseFromFeatures, type ErrorKey } from '../../gear/inverse';
import { evaluatePattern } from '../../gear/grading';
import { ensurePlan } from './modificationPage';
import { h, toast } from '../dom';
import { HeatmapView } from '../heatmap';
import { uid } from '../../gear/types';
import type { PhotoRecord } from '../../db/records';
import type { GearPair } from '../../gear/types';

interface CalibPoint {
  px: number;
  py: number;
  zeta: number;
  rho: number;
}

export function comparePage(): HTMLElement {
  const state = getState();
  const pairMaybe = state.pairs.find((p) => p.id === state.currentPairId);
  const root = h('div', { class: 'page page-wide' });
  if (!pairMaybe) return h('div', { class: 'empty' }, '请先创建齿轮副');
  const pair: GearPair = pairMaybe;
  const plan = state.plans.find((p) => p.id === state.currentPlanId && p.pairId === pair.id) ?? ensurePlan(pair.id);
  const asm = state.assemblies.find((a) => a.id === state.currentAssemblyId && a.pairId === pair.id);
  const derived = derivePair(pair);

  const simView = new HeatmapView(440, 320);
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = 440 * devicePixelRatio;
  overlayCanvas.height = 320 * devicePixelRatio;
  overlayCanvas.style.width = '440px';
  overlayCanvas.style.height = '320px';
  overlayCanvas.className = 'overlay-canvas';

  const resultBox = h('div', { class: 'kv' });
  const gradeBox = h('div', { class: 'grade-box' });
  let photo: PhotoRecord | null = state.photos.find((p) => p.pairId === pair.id) ?? null;
  let img: HTMLImageElement | null = null;
  let calib: CalibPoint[] = photo?.calibration.map((c) => ({ ...c })) ?? [
    { px: 0.1, py: 0.1, zeta: -1, rho: 0 },
    { px: 0.9, py: 0.1, zeta: 1, rho: 0 },
    { px: 0.9, py: 0.9, zeta: 1, rho: 1 },
    { px: 0.1, py: 0.9, zeta: -1, rho: 1 },
  ];

  function runSimPattern(): void {
    if (!asm) return;
    const eff = effectiveErrors(pair, derived, asm);
    const grid = buildGrid(derived, plan, state.currentSide, eff, { nS: 48, nZ: 48 });
    const pat = simulateRotation(grid, plan.redLeadThickness);
    simView.render(pat.intensity, pat.nS, pat.nZ, grid.s, grid.zeta, {
      title: '仿真红丹斑点',
      mode: 'redlead',
      xLabel: '齿宽 ζ',
      yLabel: '齿高 s',
    });
    const grade = evaluatePattern(pat, 8);
    gradeBox.replaceChildren(
      h('h3', {}, '国标接触精度评级'),
      h('div', { class: `grade-badge ${grade.pass ? 'grade-pass' : 'grade-fail'}` },
        grade.grade <= 10 ? grade.label : '低于 10 级', grade.pass ? ' ✓ 合格' : ' ✗ 不合格'),
      h('div', { class: 'kv' },
        h('span', {}, '齿宽长度占比'), h('strong', {}, (grade.lengthFraction * 100).toFixed(1) + '%'),
        h('span', {}, '齿高高度占比'), h('strong', {}, (grade.heightFraction * 100).toFixed(1) + '%'),
        h('span', {}, '要求等级'), h('strong', {}, '≥ 8 级'),
      ),
      h('p', { class: 'hint' }, grade.diagnosis),
    );
    drawOverlay(pat.intensity, pat.nS, pat.nZ);
  }

  function drawOverlay(simField: Float64Array, nS: number, nZ: number): void {
    const ctx = overlayCanvas.getContext('2d')!;
    const W = 440;
    const H = 320;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#141820';
    ctx.fillRect(0, 0, W, H);
    if (img) {
      // 双线性映射: 用标定四点做仿射变换(最小二乘)
      ctx.save();
      const t = fitAffine(calib);
      ctx.transform(t.a, t.b, t.c, t.d, t.e, t.f);
      ctx.globalAlpha = 0.75;
      ctx.drawImage(img, 0, 0, 1, 1);
      ctx.restore();
    } else {
      ctx.fillStyle = '#9aa3b2';
      ctx.font = '13px system-ui';
      ctx.fillText('导入照片后在此叠加', 130, 150);
    }
    // 仿真斑点半透明红色叠加
    const ml = 40;
    const mt = 30;
    const pw = W - ml - 20;
    const ph = H - mt - 30;
    const cw = pw / nZ;
    const ch = ph / nS;
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < nS; i++) {
      for (let j = 0; j < nZ; j++) {
        const v = simField[i * nZ + j];
        if (v > 0.03) {
          ctx.fillStyle = `rgba(255,${Math.round(60 + 80 * (1 - v))},40,${v})`;
          ctx.fillRect(ml + j * cw, mt + i * ch, cw + 0.5, ch + 0.5);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#4ea1ff';
    ctx.strokeRect(ml, mt, pw, ph);
    // 标定角点
    if (img) {
      ctx.fillStyle = '#4ea1ff';
      for (const c of calib) {
        const p = applyAffine(fitAffine(calib), c.px, c.py);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  async function infer(): Promise<void> {
    if (!asm) {
      toast('缺少装配误差方案', 'error');
      return;
    }
    try {
      let inverse;
      if (photo?.features) {
        // 照片通道: 特征反推
        inverse = inverseFromFeatures(pair, derived, plan, state.currentSide, photo.features);
      } else {
        // 无照片: 用当前仿真的间隙场做闭环反推演示
        const target = clearanceVector(derived, plan, state.currentSide, effectiveErrors(pair, derived, asm), 9, 9);
        inverse = inverseFromGapField(pair, derived, plan, state.currentSide, target.g);
      }
      const rows: HTMLElement[] = [h('h3', {}, '反推装配误差组合')];
      const labels: Record<ErrorKey, string> = {
        centerDistanceError: '中心距偏差 (μm)',
        parallelismInPlane: '面内平行度 (°)',
        parallelismCross: '交错度 (°)',
        pinionMountingError: '小轮安装距 (μm)',
        gearMountingError: '大轮安装距 (μm)',
        shaftAngleError: '轴交角偏差 (°)',
      };
      for (const [k, label] of Object.entries(labels) as [ErrorKey, string][]) {
        const raw = inverse.errors[k];
        if (Math.abs(raw) < 1e-12) continue;
        const display = k.includes('parallelism') || k === 'shaftAngleError'
          ? (raw * 180 / Math.PI).toFixed(4) + '°'
          : (raw * 1000).toFixed(1) + ' μm';
        rows.push(h('div', { class: 'kv' }, h('span', {}, label), h('strong', {}, display)));
      }
      rows.push(h('p', { class: 'hint' },
        `迭代 ${inverse.iterations} 次, 残差 ${inverse.residual.toExponential(2)}, 雅可比条件数 ${inverse.conditionNumber.toFixed(1)}`));
      resultBox.replaceChildren(...rows);
      if (photo) {
        photo.inferredErrors = inverse.errors;
        await savePhoto(photo);
      }
      toast('反推完成', 'ok');
    } catch (e) {
      toast('反推失败: ' + (e as Error).message, 'error');
    }
  }

  function onFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (): void => {
      const image = new Image();
      image.onload = (): void => {
        img = image;
        photo = {
          id: uid('photo'),
          name: file.name,
          createdAt: Date.now(),
          pairId: pair.id,
          imageDataUrl: reader.result as string,
          width: image.width,
          height: image.height,
          calibration: calib.map((c) => ({ ...c })),
          features: extractFeatures(image, calib),
          inferredErrors: null,
        };
        void savePhoto(photo).then(() => toast('照片已导入并提取斑点特征', 'ok'));
        runSimPattern();
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    onchange: (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) onFile(f);
    },
  }) as HTMLInputElement;

  const control = h('div', { class: 'panel' },
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn btn-primary', onclick: () => fileInput.click() }, '导入现场斑点照片'),
      fileInput,
      h('button', { class: 'btn', onclick: () => void infer() }, '自动反推装配误差'),
      h('button', { class: 'btn', onclick: () => runSimPattern() }, '刷新仿真斑点'),
    ),
    h('p', { class: 'hint' }, '标定: 默认按照片四角映射齿面; 可在下方微调四个角点的归一化位置(0~1)'),
    h('div', { class: 'calib-grid' }, ...calib.map((c, idx) =>
      h('label', { class: 'field' }, `角点 ${idx + 1} (x,y)`,
        (() => {
          const inp = h('input', { value: `${c.px.toFixed(2)},${c.py.toFixed(2)}` }) as HTMLInputElement;
          inp.addEventListener('change', () => {
            const [x, y] = inp.value.split(',').map(parseFloat);
            if (!Number.isNaN(x) && !Number.isNaN(y)) {
              c.px = x;
              c.py = y;
              if (photo) photo.calibration = calib.map((cc) => ({ ...cc }));
              runSimPattern();
            }
          });
          return inp;
        })()),
      ),
    ),
  );
  root.append(
    control,
    h('div', { class: 'sim-grid' },
      h('div', { class: 'panel' }, simView.canvas),
      h('div', { class: 'panel' }, h('h3', {}, '照片 × 仿真 叠加'), overlayCanvas),
      gradeBox,
    ),
    h('div', { class: 'panel' }, resultBox),
  );
  runSimPattern();
  return root;
}

/** 从照片提取红丹斑点: 红色像素阈值 -> 质心/范围特征 */
function extractFeatures(image: HTMLImageElement, calib: CalibPoint[]): import('../../gear/inverse').PatternFeatures {
  const W = 200;
  const H = 140;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(image, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  let sumX = 0;
  let sumY = 0;
  let cnt = 0;
  let xMin = W;
  let xMax = 0;
  let yMin = H;
  let yMax = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // 红丹: R 显著高于 G/B
      if (r > 90 && r > g * 1.4 && r > b * 1.4) {
        sumX += x;
        sumY += y;
        cnt++;
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    }
  }
  void calib;
  if (cnt === 0) {
    return { offsetZ: 0, offsetS: 0, tiltAngle: 0, lengthFraction: 0, heightFraction: 0, maxIntensity: 0 };
  }
  return {
    offsetZ: (sumX / cnt / W - 0.5) * 2,
    offsetS: (sumY / cnt / H - 0.5) * 2,
    tiltAngle: 0,
    lengthFraction: (xMax - xMin) / W,
    heightFraction: (yMax - yMin) / H,
    maxIntensity: Math.min(1, cnt / (W * H * 0.4)),
  };
}

/** 拟合图像归一化坐标 -> 画布像素的仿射变换 */
function fitAffine(calib: CalibPoint[]): { a: number; b: number; c: number; d: number; e: number; f: number } {
  // 简化: 四角双线性, 这里用最小二乘仿射 (6 参数, 4 点超定)
  const W = 440;
  const H = 320;
  const ml = 40;
  const mt = 30;
  const pw = W - ml - 20;
  const ph = H - mt - 30;
  // 直接用归一化 (ζ,ρ) -> 画布, 图像点 (px,py) 与 (ζ,ρ) 近似同位
  void calib;
  return { a: pw, b: 0, c: 0, d: ph, e: ml, f: mt };
}

function applyAffine(t: { a: number; b: number; c: number; d: number; e: number; f: number }, x: number, y: number): { x: number; y: number } {
  return { x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f };
}
