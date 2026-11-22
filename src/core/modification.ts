/**
 * 齿面修形:把修形方案折算成法向材料去除量 δ(μm)。
 *  - 齿向类(鼓形/齿端修薄/螺旋角修正/拓扑): δ = f(t), t = z/B ∈ [0,1]
 *  - 齿廓类(齿顶修缘/齿形鼓形): δ = f(s), s = 啮合线归一化坐标 ∈ [0,1]
 * 去除量为正 → 间隙增大。
 */
import type { ModificationSpec } from './types';

/** 齿向修形量 (μm), t∈[0,1] */
export function leadModification(m: ModificationSpec, t: number): number {
  let d = 0;
  // 鼓形:抛物线,中点最大
  d += m.crowning * 4 * (t - 0.5) * (t - 0.5);
  // 齿端修薄:两端各 length 内线性升到 amount
  if (m.endReliefLength > 0 && m.endReliefAmount > 0) {
    const B = 1; // t 已归一化,长度按比例换算由调用方处理 —— 这里用绝对长度需齿宽
    void B;
  }
  // 螺旋角修正:线性,右端正
  d += m.helixCorrection * (t - 0.5);
  return d;
}

/** 齿端修薄(需要实际齿宽换算), t∈[0,1], faceWidth mm */
export function endRelief(m: ModificationSpec, t: number, faceWidth: number): number {
  if (m.endReliefAmount <= 0 || m.endReliefLength <= 0) return 0;
  const e = m.endReliefLength / faceWidth; // 归一化端部长度
  if (t < e) return m.endReliefAmount * (1 - t / e);
  if (t > 1 - e) return m.endReliefAmount * (1 - (1 - t) / e);
  return 0;
}

/** 齿廓修形量 (μm), s∈[0,1]: 0=齿根侧啮合起点, 1=齿顶 */
export function profileModification(m: ModificationSpec, s: number): number {
  let d = 0;
  // 齿顶修缘:从 tipReliefStart 到齿顶抛物线上升
  if (m.tipReliefAmount > 0 && s > m.tipReliefStart) {
    const u = (s - m.tipReliefStart) / Math.max(1e-6, 1 - m.tipReliefStart);
    d += m.tipReliefAmount * u * u;
  }
  // 齿形鼓形:抛物线,中点最大
  d += m.profileCrowning * 4 * (s - 0.5) * (s - 0.5);
  return d;
}

/** 自由拓扑网格插值 (μm), rows=齿向, cols=齿廓 */
export function topologyAt(m: ModificationSpec, t: number, s: number): number {
  const g = m.topology;
  if (!g || g.length === 0) return 0;
  const rows = g.length, cols = g[0].length;
  const ft = Math.min(rows - 1e-9, Math.max(0, t * (rows - 1)));
  const fs = Math.min(cols - 1e-9, Math.max(0, s * (cols - 1)));
  const i0 = Math.floor(ft), j0 = Math.floor(fs);
  const i1 = Math.min(rows - 1, i0 + 1), j1 = Math.min(cols - 1, j0 + 1);
  const a = ft - i0, b = fs - j0;
  return (
    g[i0][j0] * (1 - a) * (1 - b) +
    g[i1][j0] * a * (1 - b) +
    g[i0][j1] * (1 - a) * b +
    g[i1][j1] * a * b
  );
}

/** 单侧齿面总修形量 (μm) */
export function totalModification(m: ModificationSpec | null, t: number, s: number, faceWidth: number): number {
  if (!m) return 0;
  return leadModification(m, t) + endRelief(m, t, faceWidth) + profileModification(m, s) + topologyAt(m, t, s);
}
