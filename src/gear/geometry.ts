/**
 * 圆柱渐开线齿轮几何
 * 坐标系: 齿轮轴线 = z 轴, 一个轮齿对称面在转角 0 处, x-y 为端面
 * 旋向约定: 右旋 h=+1 —— z 增大时齿面绕 +z 正向扭转
 */
import type { GearParams, SurfaceGrid, SurfacePoint, Vec3 } from './types';
import { rotZ } from './math3d';

export interface DerivedGear {
  mt: number; // 端面模数
  alphaT: number; // 端面压力角
  betaB: number; // 基圆螺旋角
  r: number; // 分度圆半径
  rb: number; // 基圆半径
  ra: number; // 齿顶圆半径
  rf: number; // 齿根圆半径
  /** 分度圆半齿厚角 (rad) */
  halfToothAngle: number;
  /** 分度圆处渐开线滚动参数 u = tan αt */
  uPitch: number;
  /** 旋向符号 */
  handSign: number;
  invAlphaT: number;
}

export const involuteInv = (alpha: number): number => Math.tan(alpha) - alpha;

export function deriveGear(g: GearParams): DerivedGear {
  const beta = g.helixAngle;
  const mt = g.module / Math.cos(beta);
  const alphaT = Math.atan(Math.tan(g.pressureAngle) / Math.cos(beta));
  const betaB = Math.atan(Math.tan(beta) * Math.cos(alphaT));
  const r = (mt * g.teeth) / 2;
  const rb = r * Math.cos(alphaT);
  const ha = g.module * (g.addendumCoef + g.profileShift);
  const hf = g.module * (g.addendumCoef + g.clearanceCoef - g.profileShift);
  const ra = r + ha;
  const rf = r - hf;
  // 分度圆端面齿厚: st = mt(π/2 + 2 x tan αt)
  const st = mt * (Math.PI / 2 + 2 * g.profileShift * Math.tan(alphaT));
  const halfToothAngle = st / (2 * r);
  const uPitch = Math.tan(alphaT);
  return {
    mt,
    alphaT,
    betaB,
    r,
    rb,
    ra,
    rf,
    halfToothAngle,
    uPitch,
    handSign: g.hand === 'right' ? 1 : -1,
    invAlphaT: involuteInv(alphaT),
  };
}

/** 滚动参数 u (=tan α) 对应半径 */
export const radiusAtRoll = (d: DerivedGear, u: number): number => d.rb * Math.hypot(1, u);

/** 半径 r 处的滚动参数 */
export function rollAtRadius(d: DerivedGear, radius: number): number {
  const q = Math.max(1, radius / d.rb);
  return Math.sqrt(q * q - 1);
}

/**
 * 端面渐开线点(单侧齿面)
 * @param flankSign +1: 角度正向侧齿面; -1: 另一侧
 * @param u 滚动参数
 */
function involutePoint2D(d: DerivedGear, flankSign: number, u: number): { x: number; y: number } {
  const alpha = Math.atan(u);
  const theta = flankSign * (d.halfToothAngle + d.invAlphaT - involuteInv(alpha));
  const radius = d.rb * Math.hypot(1, u);
  return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
}

/** 端面渐开线单位法向(指向齿外), 用于齿面网格 */
function involuteNormal2D(d: DerivedGear, flankSign: number, u: number): Vec3 {
  const alpha = Math.atan(u);
  const theta = flankSign * (d.halfToothAngle + d.invAlphaT - involuteInv(alpha));
  // 渐开线法向沿发生线方向: 极角 theta 处法向角 = theta + flankSign*α (指向体外)
  const na = theta + flankSign * alpha;
  return { x: Math.cos(na), y: Math.sin(na), z: 0 };
}

/** 螺旋齿面: z 处附加扭转 */
function helixTwist(d: DerivedGear, z: number): number {
  return (d.handSign * z * Math.tan(d.betaB)) / d.rb;
}

/**
 * 齿根过渡曲线(切线连续的圆弧近似, ISO 齿条刀尖圆角 ρf0=0.38mn)
 * 返回从齿根圆到渐开线起点的二维采样 (含两端点), 角度位于 flankSign 侧
 */
export function filletPoints2D(g: GearParams, d: DerivedGear, flankSign: number, n = 8): Vec3[] {
  const rho = 0.38 * g.module;
  // 渐开线允许的最低半径: 基圆与齿根圆取大者, 再留出过渡切点
  const rInvoluteMin = Math.max(d.rb, d.rf + rho * 0.25);
  const uMin = rollAtRadius(d, rInvoluteMin);
  const pInv = involutePoint2D(d, flankSign, uMin);
  // 齿根圆上的端点: 沿径向取在 pInv 同侧
  const aRoot = Math.atan2(pInv.y, pInv.x);
  const pRoot = { x: d.rf * Math.cos(aRoot), y: d.rf * Math.sin(aRoot) };
  // 二次贝塞尔过渡: 控制点取两端切线交点 —— 渐开线端切线垂直于发生线
  const nInv = involuteNormal2D(d, flankSign, uMin);
  const tInv = { x: -nInv.y, y: nInv.x };
  const tRoot = { x: -Math.sin(aRoot), y: Math.cos(aRoot) };
  // 直线: PInv + s tInv = PRoot + q tRoot, 解 s
  const det = tInv.x * tRoot.y - tInv.y * tRoot.x;
  let c: { x: number; y: number };
  if (Math.abs(det) < 1e-12) {
    c = { x: (pInv.x + pRoot.x) / 2, y: (pInv.y + pRoot.y) / 2 };
  } else {
    const dx = pRoot.x - pInv.x;
    const dy = pRoot.y - pInv.y;
    const s = (dx * tRoot.y - dy * tRoot.x) / det;
    c = { x: pInv.x + s * tInv.x, y: pInv.y + s * tInv.y };
  }
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bx = (1 - t) * (1 - t) * pRoot.x + 2 * (1 - t) * t * c.x + t * t * pInv.x;
    const by = (1 - t) * (1 - t) * pRoot.y + 2 * (1 - t) * t * c.y + t * t * pInv.y;
    out.push({ x: bx, y: by, z: 0 });
  }
  return out;
}

/**
 * 生成单个轮齿单侧三维齿面网格
 * @param g 齿轮参数
 * @param flankSign 齿面侧 (+1/-1)
 * @param nR 齿高方向格数
 * @param nZ 齿宽方向格数
 * @param includeFillet 是否附带齿根过渡曲线行
 */
export function toothSurface(
  g: GearParams,
  flankSign: number,
  nR = 24,
  nZ = 24,
  includeFillet = true,
): SurfaceGrid {
  const d = deriveGear(g);
  const points: SurfacePoint[] = [];
  const rMin = Math.max(d.rb, d.rf + g.module * 0.05);
  const uMin = rollAtRadius(d, rMin);
  const uMax = rollAtRadius(d, d.ra);
  const z0 = -g.faceWidth / 2;

  interface Row {
    r: number;
    u: number;
    p2?: { x: number; y: number };
    n2?: Vec3;
  }
  const rows: Row[] = [];
  if (includeFillet) {
    const fp = filletPoints2D(g, d, flankSign, 6);
    for (let i = 0; i < fp.length - 1; i++) {
      const rr = Math.hypot(fp[i].x, fp[i].y);
      rows.push({
        r: rr,
        u: NaN,
        p2: { x: fp[i].x, y: fp[i].y },
        n2: { x: fp[i].x / rr, y: fp[i].y / rr, z: 0 },
      });
    }
  }
  for (let i = 0; i <= nR; i++) {
    const u = uMin + ((uMax - uMin) * i) / nR;
    rows.push({ r: radiusAtRoll(d, u), u });
  }

  for (const row of rows) {
    for (let j = 0; j <= nZ; j++) {
      const z = z0 + (g.faceWidth * j) / nZ;
      const tw = helixTwist(d, z);
      let p2: { x: number; y: number };
      let n2: Vec3;
      if (Number.isNaN(row.u)) {
        p2 = row.p2!;
        n2 = row.n2!;
      } else {
        p2 = involutePoint2D(d, flankSign, row.u);
        n2 = involuteNormal2D(d, flankSign, row.u);
      }
      const p = rotZ({ x: p2.x, y: p2.y, z }, tw);
      const n = rotZ(n2, tw);
      points.push({ p, n, r: row.r, z });
    }
  }
  return { points, nR: rows.length - 1, nZ };
}

/** 完整齿轮(所有齿)三维点, 用于 Three.js 渲染 */
export function gearToothWorldPoints(g: GearParams, nR = 20, nZ = 16): Vec3[] {
  const d = deriveGear(g);
  const grid = toothSurface(g, 1, nR, nZ, true);
  const pitch = (2 * Math.PI) / g.teeth;
  const out: Vec3[] = [];
  for (let k = 0; k < g.teeth; k++) {
    for (const sp of grid.points) {
      out.push(rotZ(sp.p, k * pitch));
    }
  }
  void d;
  return out;
}

/** 齿面任意 (半径, z) 处的法向与位置 (单侧, 供 TCA/修形叠加) */
export function surfaceAt(g: GearParams, flankSign: number, radius: number, z: number): SurfacePoint {
  const d = deriveGear(g);
  const u = rollAtRadius(d, Math.max(radius, d.rb * 1.0001));
  const p2 = involutePoint2D(d, flankSign, u);
  const n2 = involuteNormal2D(d, flankSign, u);
  const tw = helixTwist(d, z);
  return { p: rotZ({ x: p2.x, y: p2.y, z }, tw), n: rotZ(n2, tw), r: radius, z };
}
