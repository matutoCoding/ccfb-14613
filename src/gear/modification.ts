/**
 * 齿面修形
 * 四类: 齿向鼓形 / 齿端修薄 / 齿顶修缘 / 螺旋角修正, 另支持自由拓扑叠加
 * 所有修形量输入单位 μm, 内部计算转 mm; 修形=去除材料, 统一增大法向间隙
 */
import type { FlankSide } from './types';

export interface ModificationParams {
  /** 齿向鼓形量 Cβ (μm), 齿宽中部最大 */
  leadCrown: number;
  /** 齿端修薄量 Ce (μm), 两端各自的最大修薄 */
  endRelief: number;
  /** 齿端修薄长度 Le (mm), 每端 */
  endReliefLength: number;
  /** 齿顶修缘量 Ca (μm) */
  tipRelief: number;
  /** 齿顶修缘深度 La (mm), 自齿顶向齿根 */
  tipReliefDepth: number;
  /** 螺旋角修正量 (μm): 齿宽边缘处的线性峰值, 全齿宽峰峰值=2倍 */
  helixCorrection: number;
  /** 自由拓扑编辑覆盖量 (μm), 行=齿高 nR, 列=齿宽 nZ, 与上述叠加 */
  topology: Float64Array | null;
  topoNR: number;
  topoNZ: number;
}

export interface GearModification {
  working: ModificationParams;
  nonworking: ModificationParams;
}

export interface ModificationPlan {
  id: string;
  name: string;
  updatedAt: number;
  pairId: string;
  pinion: GearModification;
  gear: GearModification;
  /** 红丹层厚度 (μm) */
  redLeadThickness: number;
}

export function defaultModParams(): ModificationParams {
  return {
    leadCrown: 0,
    endRelief: 0,
    endReliefLength: 0,
    tipRelief: 0,
    tipReliefDepth: 0,
    helixCorrection: 0,
    topology: null,
    topoNR: 16,
    topoNZ: 32,
  };
}

export function defaultPlan(pairId: string, id: string): ModificationPlan {
  return {
    id,
    name: '默认修形方案(零修形)',
    updatedAt: Date.now(),
    pairId,
    pinion: { working: defaultModParams(), nonworking: defaultModParams() },
    gear: { working: defaultModParams(), nonworking: defaultModParams() },
    redLeadThickness: 5,
  };
}

const UM = 1e-3; // μm -> mm

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 单侧齿面修形量 (mm)
 * @param m 修形参数
 * @param zetaBar 归一化齿向坐标 [-1,1]
 * @param rhoBar  归一化齿高坐标 [0,1], 0=齿顶, 1=齿根
 * @param faceWidth 齿宽 mm
 * @param activeDepth 有效齿高 mm
 */
export function modificationAt(
  m: ModificationParams,
  zetaBar: number,
  rhoBar: number,
  faceWidth: number,
  activeDepth: number,
): number {
  let val = 0;
  // 1. 齿向鼓形: 抛物线, 中部 0 -> 两端 Cβ
  val += m.leadCrown * zetaBar * zetaBar;
  // 2. 齿端修薄: |ζ| 超过 (b/2-Le) 后二次爬升
  if (m.endRelief > 0 && m.endReliefLength > 0) {
    const zAbs = (Math.abs(zetaBar) * faceWidth) / 2;
    const start = faceWidth / 2 - m.endReliefLength;
    const t = smoothstep(start, faceWidth / 2, zAbs);
    val += m.endRelief * t * t;
  }
  // 3. 齿顶修缘: 距齿顶 dTip < La 区域
  if (m.tipRelief > 0 && m.tipReliefDepth > 0) {
    const dTip = rhoBar * activeDepth;
    const t = 1 - smoothstep(0, m.tipReliefDepth, dTip);
    val += m.tipRelief * t * t;
  }
  // 4. 螺旋角修正: 齿向线性
  val += m.helixCorrection * zetaBar;
  // 5. 自由拓扑双线性插值
  if (m.topology && m.topoNR > 1 && m.topoNZ > 1) {
    const fx = (zetaBar + 1) / 2 * (m.topoNZ - 1);
    const fy = rhoBar * (m.topoNR - 1);
    const j0 = Math.min(m.topoNZ - 2, Math.max(0, Math.floor(fx)));
    const i0 = Math.min(m.topoNR - 2, Math.max(0, Math.floor(fy)));
    const tx = fx - j0;
    const ty = fy - i0;
    const g = m.topology;
    const at = (i: number, j: number): number => g[i * m.topoNZ + j];
    val +=
      (1 - tx) * (1 - ty) * at(i0, j0) +
      tx * (1 - ty) * at(i0, j0 + 1) +
      (1 - tx) * ty * at(i0 + 1, j0) +
      tx * ty * at(i0 + 1, j0 + 1);
  }
  return val * UM;
}

/** 生成拓扑编辑网格(μm), 供页面画布编辑 */
export function emptyTopology(nR: number, nZ: number): Float64Array {
  return new Float64Array(nR * nZ);
}

export function sideParams(plan: ModificationPlan, which: 'pinion' | 'gear', side: FlankSide): ModificationParams {
  return which === 'pinion' ? plan.pinion[side] : plan.gear[side];
}
