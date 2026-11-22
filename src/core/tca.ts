/**
 * 啮合仿真核心(截面法 TCA,CPU 参考实现)。
 * WGSL 计算着色器(gpu/gapfield-wgsl.ts)与此文件逐行对应,改动必须两边同步。
 *
 * 模型:平行轴(或当量)齿轮副,每个端截面等效为二维渐开线啮合。
 * 间隙场 g(ξ,t):网格覆盖全齿廓对应的啮合线段(含余量),实际接触窗口
 * [xiMin, xiMax] 随中心距变化而移动 —— 中心距偏差因此改变斑点在齿高方向的位置。
 * 修形量锚定在牙齿坐标(形圆=0 → 齿顶=1),不随窗口移动。
 * 零修形零误差时窗口内 g ≡ 0 → 斑点贯穿全齿宽、传动误差为零(验收基准)。
 *
 * 单位:间隙 μm;长度 mm;角度 rad。
 */
import type { ModificationSpec, SimSettings, GapFieldResult } from './types';
import type { MeshGeometry } from './involute';
import { totalModification } from './modification';

export interface TcaErrors {
  dCenterUm: number;   // 中心距偏差 (μm)
  slopeParUm: number;  // 平行度(中心距平面内, μm/全齿宽)
  slopeSkewUm: number; // 交错度(μm/全齿宽)
}

export interface TcaInput {
  mesh: MeshGeometry;
  pbt: number;        // 端面基圆齿距 mm
  rb1: number;        // 小轮基圆半径 mm
  rb2: number;        // 大轮基圆半径 mm
  faceWidth: number;  // mm
  /** 网格覆盖的啮合线范围(含余量), mm */
  xiGridMin: number;
  xiGridMax: number;
  errors: TcaErrors;
  modPinion: ModificationSpec | null;
  modGear: ModificationSpec | null;
  settings: SimSettings;
}

/** 网格坐标 s∈[0,1] → 啮合线坐标 ξ (mm) */
export function gridXi(inp: TcaInput, s: number): number {
  return inp.xiGridMin + s * (inp.xiGridMax - inp.xiGridMin);
}

/**
 * 实际接触窗口 [xiMin, xiMax] (mm),按各齿向截面的实际中心距精确计算:
 * a(t) = a名义 + (Δa + fx·(t−0.5))/1000;窗口随 a 平移且宽度变化
 * (中心距拉大 → 啮合线 T1T2 变长 → 窗口变窄,斑点高度%下降)。
 * 这是中心距偏差与平行度在斑点上可辨识的关键效应。
 */
export function windowBounds(inp: TcaInput, t: number): [number, number] {
  const a = inp.mesh.a + (inp.errors.dCenterUm + inp.errors.slopeParUm * (t - 0.5)) / 1000;
  const cosA = Math.min(1, (inp.mesh.rb1 + inp.mesh.rb2) / a);
  const t1t2 = a * Math.sin(Math.acos(cosA));
  return [t1t2 - inp.mesh.tipRoll2, inp.mesh.tipRoll1];
}

/** 窗口边缘过渡宽度 (mm):齿根/齿顶边缘效应使斑点边界平滑(物理上确实存在) */
export const EDGE_W = 0.05;

/**
 * 窗口边缘因子 ∈ [0,1]:窗口内→1,窗口外→0,边缘处平滑过渡。
 * 连续的边缘使窗口位置(从而中心距偏差)可被亚网格精度观测。
 */
export function edgeFactor(inp: TcaInput, t: number, xi: number): number {
  const [lo, hi] = windowBounds(inp, t);
  const sig = (x: number): number => {
    const c = Math.max(-30, Math.min(30, x));
    return 1 / (1 + Math.exp(-c));
  };
  return sig((xi - lo) / EDGE_W) * sig((hi - xi) / EDGE_W);
}

/** 单元 (i,j) 是否在实际接触窗口内(窗口随齿向截面变化) */
export function cellActive(inp: TcaInput, nF: number, nP: number, i: number, j: number): boolean {
  const t = nF === 1 ? 0.5 : i / (nF - 1);
  const xi = gridXi(inp, nP === 1 ? 0.5 : j / (nP - 1));
  return edgeFactor(inp, t, xi) > 0.5;
}

/** 牙齿坐标:小轮 形圆=0 → 齿顶=1;大轮同理(接触在大轮齿顶时 ξ 小) */
export function toothCoords(inp: TcaInput, xi: number): { sPin: number; sGear: number } {
  const m = inp.mesh;
  const sPin = (xi - m.xiForm1) / Math.max(1e-9, m.tipRoll1 - m.xiForm1);
  const sGear = ((m.t1t2 - xi) - m.xiForm2) / Math.max(1e-9, m.tipRoll2 - m.xiForm2);
  return {
    sPin: Math.min(1, Math.max(0, sPin)),
    sGear: Math.min(1, Math.max(0, sGear)),
  };
}

/** 单点间隙 (μm) —— 与 WGSL gapAt() 对应 */
export function gapAt(inp: TcaInput, t: number, s: number): number {
  const sinA = Math.sin(inp.mesh.alphaT1);
  let g = inp.errors.dCenterUm * sinA;
  g += inp.errors.slopeParUm * (t - 0.5) * sinA;
  g += inp.errors.slopeSkewUm * (t - 0.5);
  const { sPin, sGear } = toothCoords(inp, gridXi(inp, s));
  g += totalModification(inp.modPinion, t, sPin, inp.faceWidth);
  g += totalModification(inp.modGear, t, sGear, inp.faceWidth);
  return g;
}

export interface GapFieldOut {
  gap: Float32Array; // [nFace * nProfile], 行=齿向
  nFace: number;
  nProfile: number;
}

export function computeGapField(inp: TcaInput): GapFieldOut {
  const nF = inp.settings.faceSections;
  const nP = inp.settings.profileSamples;
  const gap = new Float32Array(nF * nP);
  for (let i = 0; i < nF; i++) {
    const t = nF === 1 ? 0.5 : i / (nF - 1);
    for (let j = 0; j < nP; j++) {
      const s = nP === 1 ? 0.5 : j / (nP - 1);
      gap[i * nP + j] = gapAt(inp, t, s);
    }
  }
  return { gap, nFace: nF, nProfile: nP };
}

/** 列 j 是否在实际接触窗口内(取中间截面,用于兼容旧调用) */
export function columnActive(inp: TcaInput, nP: number, j: number): boolean {
  const xi = gridXi(inp, nP === 1 ? 0.5 : j / (nP - 1));
  return xi >= inp.mesh.xiMin - 1e-9 && xi <= inp.mesh.xiMax + 1e-9;
}

/**
 * 由间隙场生成斑点掩膜 + 传动误差。
 * 同时接触坐标集合:{ξ + k·pbt};瞬时最小间隙 G(ξ) 决定刚体贴近量;
 * 斑点判据: g(ξ,t) ≤ G(ξ) + 红丹层厚;窗口外的网格不参与。
 */
export function analyzeGapField(inp: TcaInput, field: GapFieldOut): GapFieldResult {
  const { nFace: nF, nProfile: nP, gap } = field;
  const gridSpan = inp.xiGridMax - inp.xiGridMin;
  const pbtCells = (inp.pbt / gridSpan) * (nP - 1); // 基节对应的网格列数
  const paint = inp.settings.paintThickness;

  const active: boolean[] = []; // 按单元 (i*nP+j)
  for (let i = 0; i < nF; i++)
    for (let j = 0; j < nP; j++) active.push(cellActive(inp, nF, nP, i, j));
  const colAnyActive = new Array<boolean>(nP).fill(false);
  for (let j = 0; j < nP; j++)
    for (let i = 0; i < nF; i++) if (active[i * nP + j]) { colAnyActive[j] = true; break; }

  // G(ξ_j): 对每个接触坐标,取所有同相接触列(±k·pbt)与全部齿向截面活动单元的最小间隙
  const minGapPerContact = new Float32Array(nP).fill(Infinity);
  for (let j = 0; j < nP; j++) {
    if (!colAnyActive[j]) continue;
    let gMin = Infinity;
    for (let k = -8; k <= 8; k++) {
      const jj = j + Math.round(k * pbtCells);
      if (jj < 0 || jj >= nP) continue;
      for (let i = 0; i < nF; i++) {
        if (!active[i * nP + jj]) continue;
        const g = gap[i * nP + jj];
        if (g < gMin) gMin = g;
      }
    }
    minGapPerContact[j] = gMin;
  }

  // 斑点掩膜(仅窗口内单元)
  const mask = new Uint8Array(nF * nP);
  for (let i = 0; i < nF; i++) {
    for (let j = 0; j < nP; j++) {
      if (!active[i * nP + j]) continue;
      mask[i * nP + j] = gap[i * nP + j] <= minGapPerContact[j] + paint ? 1 : 0;
    }
  }

  // 传动误差:接触坐标从实际窗口起点(齿宽中点截面)扫过一个基节,TE(φ) = G(ξ) − min G
  const steps = inp.settings.rotationSteps;
  const te = new Float32Array(steps);
  const [xiStart] = windowBounds(inp, 0.5);
  let teMin = Infinity;
  for (let k = 0; k < steps; k++) {
    const xi = xiStart + (k / steps) * inp.pbt;
    const fj = ((xi - inp.xiGridMin) / gridSpan) * (nP - 1);
    const j0 = Math.max(0, Math.min(nP - 1, Math.floor(fj)));
    const j1 = Math.max(0, Math.min(nP - 1, j0 + 1));
    const a = Math.min(1, Math.max(0, fj - j0));
    const g0 = minGapPerContact[j0], g1 = minGapPerContact[j1];
    const g = (Number.isFinite(g0) ? g0 : 0) * (1 - a) + (Number.isFinite(g1) ? g1 : 0) * a;
    te[k] = g;
    if (g < teMin) teMin = g;
  }
  for (let k = 0; k < steps; k++) te[k] -= teMin;

  // 斑点百分比:相对理论接触窗口(窗口内列的范围)
  let jA = -1, jB = -1;
  colAnyActive.forEach((v, j) => { if (v) { if (jA < 0) jA = j; jB = j; } });
  const colMarked = new Array<boolean>(nF).fill(false);
  const rowMarked = new Array<boolean>(nP).fill(false);
  for (let i = 0; i < nF; i++)
    for (let j = 0; j < nP; j++)
      if (mask[i * nP + j]) { colMarked[i] = true; rowMarked[j] = true; }
  const extent = (arr: boolean[], lo: number, hi: number): number => {
    let a = -1, b = -1;
    for (let idx = lo; idx <= hi; idx++) if (arr[idx]) { if (a < 0) a = idx; b = idx; }
    return a < 0 ? 0 : (b - a) / Math.max(1, hi - lo);
  };
  const patternLengthPct = extent(colMarked, 0, nF - 1) * 100;
  const patternHeightPct = extent(rowMarked, Math.max(0, jA), Math.max(0, jB)) * 100;

  return {
    gap, nFace: nF, nProfile: nP,
    minGapPerContact, mask,
    transmissionError: te,
    patternLengthPct, patternHeightPct,
  };
}

/**
 * 连续(软)斑点图:sigmoid((G+层厚−g)/k) ∈ [0,1]。
 * 保留了间隙的连续信息,是误差反推的目标图(硬掩膜会丢失亚网格信息)。
 */
export function softMask(inp: TcaInput, field: GapFieldOut, softK: number): Float32Array {
  const { nFace: nF, nProfile: nP, gap } = field;
  const paint = inp.settings.paintThickness;
  const out = new Float32Array(nF * nP);
  // 先算 G(ξ_j)(与 analyzeGapField 相同逻辑)
  const gridSpan = inp.xiGridMax - inp.xiGridMin;
  const pbtCells = (inp.pbt / gridSpan) * (nP - 1);
  const active: boolean[] = [];
  for (let i = 0; i < nF; i++)
    for (let j = 0; j < nP; j++) active.push(cellActive(inp, nF, nP, i, j));
  const G = new Float32Array(nP).fill(Infinity);
  for (let j = 0; j < nP; j++) {
    for (let k = -8; k <= 8; k++) {
      const jj = j + Math.round(k * pbtCells);
      if (jj < 0 || jj >= nP) continue;
      for (let i = 0; i < nF; i++) {
        if (!active[i * nP + jj]) continue;
        const g = gap[i * nP + jj];
        if (g < G[j]) G[j] = g;
      }
    }
  }
  for (let i = 0; i < nF; i++) {
    for (let j = 0; j < nP; j++) {
      const idx = i * nP + j;
      if (!active[idx] || !Number.isFinite(G[j])) { out[idx] = 0; continue; }
      const t = nF === 1 ? 0.5 : i / (nF - 1);
      const xi = gridXi(inp, nP === 1 ? 0.5 : j / (nP - 1));
      const ef = edgeFactor(inp, t, xi);
      const x = ((G[j] + paint) - gap[idx]) / softK; // 间隙小 → 接触概率 → 1
      const xc = Math.max(-30, Math.min(30, x));
      const sig = 1 / (1 + Math.exp(-xc));
      out[idx] = ef * sig;
    }
  }
  return out;
}

/** 传动误差统计:峰峰值(μm)与啮合频率幅值(μm, 主频=每转 z1 次) */
export function teStats(te: Float32Array): { peakToPeak: number; meshAmplitude: number } {
  let lo = Infinity, hi = -Infinity;
  for (const v of te) { if (v < lo) lo = v; if (v > hi) hi = v; }
  // 单基节周期内 TE 的基波幅值(DFT 一次谐波)
  const n = te.length;
  let re = 0, im = 0;
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    re += te[k] * Math.cos(a);
    im -= te[k] * Math.sin(a);
  }
  const meshAmplitude = (2 / n) * Math.hypot(re, im);
  return { peakToPeak: hi - lo, meshAmplitude };
}
