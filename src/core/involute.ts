/**
 * 渐开线圆柱齿轮几何:基本圆、渐开线齿廓、齿根过渡曲线(齿条刀包络)、啮合线。
 * 全部计算层函数用弧度。
 */
import type { GearParams } from './types';

export const DEG = Math.PI / 180;

export interface GearGeometry {
  mn: number;          // 法向模数
  mt: number;          // 端面模数
  z: number;
  alphaN: number;      // 法向压力角 rad
  alphaT: number;      // 端面压力角 rad
  beta: number;        // 分度圆螺旋角 rad
  betaB: number;       // 基圆螺旋角 rad
  x: number;           // 变位系数
  r: number;           // 分度圆半径
  rb: number;          // 基圆半径
  ra: number;          // 齿顶圆半径
  rf: number;          // 齿根圆半径
  rForm: number;       // 有效渐开线起始圆半径(>= rf)
  hand: 1 | -1;
  faceWidth: number;
  /** 端面基圆齿距 pbt (mm) —— 啮合线上相邻齿接触点间距 */
  pbt: number;
  /** 半齿槽宽角(端面, rad)——用于布齿 */
  halfToothAngle: number;
}

export function inv(t: number): number {
  return Math.tan(t) - t;
}

export function invInverse(invAlpha: number): number {
  // 牛顿法解 tan(a)-a = invAlpha
  let a = Math.cbrt(3 * invAlpha); // 良好初值
  for (let i = 0; i < 32; i++) {
    const f = Math.tan(a) - a - invAlpha;
    const d = 1 / (Math.cos(a) * Math.cos(a)) - 1;
    a -= f / d;
  }
  return a;
}

export function gearGeometry(p: GearParams): GearGeometry {
  const alphaN = p.pressureAngle * DEG;
  const beta = p.helixAngle * DEG;
  const mt = p.module / Math.cos(beta);
  const alphaT = Math.atan(Math.tan(alphaN) / Math.cos(beta));
  const z = p.teeth;
  const r = (mt * z) / 2;
  const rb = r * Math.cos(alphaT);
  const betaB = Math.atan(Math.tan(beta) * Math.cos(alphaT));
  // 标准齿顶高/齿根高(法向): ha* = 1, hf* = 1.25
  const ra = p.tipDiameter ? p.tipDiameter / 2 : r + (1 + p.profileShift) * p.module;
  const rf = p.rootDiameter ? p.rootDiameter / 2 : r - (1.25 - p.profileShift) * p.module;
  // 有效渐开线起点:取齿根圆与不根切限制的大者(简化:齿条刀过渡曲线与渐开线切点)
  // 切点半径:rb / cos(alphaT_form), 其中 form 点对应齿条直线段最低点
  const hStraight = 1.25 * p.module - 0.38 * p.module; // 刀尖圆角 0.38m 以上直线段
  const sinA = Math.sin(alphaT);
  const rFormLimit = Math.sqrt(
    rb * rb + Math.pow(Math.max(0, (r * sinA * sinA - (hStraight - p.profileShift * p.module)) / sinA), 2),
  );
  const rForm = Math.max(rf, Math.min(rFormLimit, ra));
  const pbt = Math.PI * mt * Math.cos(alphaT);
  // 端面半齿厚角: s_t/2 / r, s_t = π mt/2 + 2 x mn tan(αn)
  const st = (Math.PI * mt) / 2 + 2 * p.profileShift * p.module * Math.tan(alphaN);
  const halfToothAngle = st / (2 * r);
  return {
    mn: p.module, mt, z, alphaN, alphaT, beta, betaB,
    x: p.profileShift, r, rb, ra, rf, rForm,
    hand: p.hand === 'RH' ? 1 : -1,
    faceWidth: p.faceWidth, pbt, halfToothAngle,
  };
}

/** 渐开线上一点(相对齿槽中心对称轴的方位角 theta 处) */
export function involutePoint(rb: number, theta: number): [number, number] {
  return [rb * (Math.cos(theta) + theta * Math.sin(theta)), rb * (Math.sin(theta) - theta * Math.cos(theta))];
}

/** 半径 rho 处渐开线点的滚动角(展开角) */
export function rollAtRadius(rb: number, rho: number): number {
  const c = Math.min(1, rb / rho);
  return Math.tan(Math.acos(c));
}

/**
 * 单齿右侧面(工作面)二维齿廓采样点(端面截面, 齿槽中心在 +x 轴)。
 * 返回从齿根到齿顶的点列 [x, y],含齿根过渡曲线。
 * 过渡曲线:齿条刀尖圆角包络(解析),见 Litvin《齿轮几何学》。
 */
export function toothProfile2D(g: GearGeometry, n = 48, filletN = 16): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  // --- 齿根过渡曲线(齿条刀尖圆 ρf 的包络) ---
  const rhoF = 0.38 * g.mn;
  // 齿条坐标:u 沿节线(齿厚方向), v 垂直节线指向齿轮为正。
  // 刀尖圆心:v0 = -(hf* m - x m - ρf) 相对节线(节线以下为正 v? 取 v0 为刀尖圆心到节线距离,向齿轮体内为正)
  const hf = 1.25 * g.mn - g.x * g.mn; // 刀具齿顶高(相对节线)
  const v0 = hf - rhoF; // 刀尖圆心深入齿轮侧距离
  // 刀尖圆心沿节线位置:齿槽对称线上,圆心偏离 = 齿槽半宽 - ρf/tan 分量
  const u0 = (Math.PI * g.mt) / 4 + hf * Math.tan(g.alphaT) - rhoF * Math.tan(Math.PI / 4 - g.alphaT / 2);
  // 展成:齿轮转角 φ,齿条平移 r·φ。刀尖圆心在齿轮坐标系轨迹(次摆线):
  // G(φ) = R(-φ)·(r·φ - u0, -(r - v0))  (齿条节线与分度圆纯滚动)
  const center = (phi: number): [number, number] => {
    const px = g.r * phi - u0;
    const py = -(g.r - v0);
    const c = Math.cos(phi), s = Math.sin(phi);
    return [px * c + py * s, -px * s + py * c];
  };
  // 包络 = 圆心轨迹沿法向偏移 ρf
  const fillet: Array<[number, number]> = [];
  const phiMax = (u0 + v0 + rhoF) / g.r + 0.05;
  for (let i = 0; i <= filletN * 4; i++) {
    const phi = (i / (filletN * 4)) * phiMax;
    const [cx, cy] = center(phi);
    const eps = 1e-6;
    const [dx1, dy1] = center(phi + eps);
    let nx = -(dy1 - cy), ny = dx1 - cx;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    // 取朝向齿轮体外(远离圆心)的法向
    if (nx * cx + ny * cy < 0) { nx = -nx; ny = -ny; }
    fillet.push([cx + rhoF * nx, cy + rhoF * ny]);
  }
  // 只保留齿根圆到渐开线起点之间、且位于齿槽一侧的包络段
  const rFormAng = Math.atan2(
    involutePoint(g.rb, rollAtRadius(g.rb, Math.max(g.rForm, g.rb)))[1],
    involutePoint(g.rb, rollAtRadius(g.rb, Math.max(g.rForm, g.rb)))[0],
  );
  void rFormAng;
  for (const p of fillet) {
    const rr = Math.hypot(p[0], p[1]);
    if (rr >= g.rf - 1e-9 && rr <= g.rForm + 1e-9 && p[1] >= -1e-9) pts.push(p);
  }
  // --- 渐开线段 ---
  const rollStart = rollAtRadius(g.rb, Math.max(g.rForm, g.rb));
  const rollEnd = rollAtRadius(g.rb, g.ra);
  const invPts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = rollStart + ((rollEnd - rollStart) * i) / n;
    invPts.push(involutePoint(g.rb, t));
  }
  // 渐开线整体旋转,使齿厚对称轴关于 x 轴对称:
  // 基圆处渐开线方位角为 0;齿侧面应位于角 (π/z - halfToothAngle 修正) 处。
  // 分度圆上齿厚半角 = halfToothAngle;渐开线从基圆到分度圆转过 inv(alphaT)。
  const shift = Math.PI / g.z - g.halfToothAngle - inv(g.alphaT);
  const rot = (p: [number, number], a: number): [number, number] => {
    const c = Math.cos(a), s = Math.sin(a);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  };
  const invRot = invPts.map((p) => rot(p, -shift));
  // 拼接:过渡曲线已按齿槽坐标生成,旋转同一角度对齐
  const filletRot = pts.map((p) => rot(p, -shift));
  // 排序:从齿根到齿顶
  filletRot.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  return [...filletRot, ...invRot];
}

/** 啮合参数:给定中心距求啮合角与有效啮合线范围 */
export interface MeshGeometry {
  a: number;          // 实际中心距
  alphaT1: number;    // 啮合角(端面) rad
  /** 啮合线坐标 ξ:从小轮基圆切点 T1 起算,沿啮合线指向大轮 [xiMin, xiMax] */
  xiMin: number;
  xiMax: number;
  /** 两基圆切点间距 T1T2 */
  t1t2: number;
  /** 小轮:有效渐开线起点(形圆)与齿顶的滚动路径长(距 T1) */
  xiForm1: number;
  tipRoll1: number;
  /** 大轮:同上(距 T2) */
  xiForm2: number;
  tipRoll2: number;
  rb1: number;
  rb2: number;
}

export function meshGeometry(g1: GearGeometry, g2: GearGeometry, centerDistance?: number): MeshGeometry {
  const a0 = g1.r + g2.r; // 标准中心距(变位和)
  const a = centerDistance ?? a0;
  // 变位齿轮副:啮合角由无侧隙啮合方程;简化:按实际中心距反算
  const alphaT1 = Math.acos(Math.min(1, (g1.rb + g2.rb) / a));
  // 啮合线:两基圆内公切线。T1 距 T2 长度 = a·sin(α')
  const t1t2 = a * Math.sin(alphaT1);
  // 大轮齿顶圆截啮合线点(啮合起点,靠小轮齿根):距 T2 为 sqrt(ra2²-rb2²) 朝 T1 方向
  const l2 = Math.sqrt(Math.max(0, g2.ra * g2.ra - g2.rb * g2.rb));
  const l1 = Math.sqrt(Math.max(0, g1.ra * g1.ra - g1.rb * g1.rb));
  const xiMin = t1t2 - l2; // 距 T1
  const xiMax = l1;        // 距 T1
  const xiForm1 = Math.sqrt(Math.max(0, g1.rForm * g1.rForm - g1.rb * g1.rb));
  const xiForm2 = Math.sqrt(Math.max(0, g2.rForm * g2.rForm - g2.rb * g2.rb));
  return {
    a, alphaT1,
    xiMin: Math.min(xiMin, xiMax), xiMax: Math.max(xiMin, xiMax),
    t1t2, xiForm1, tipRoll1: l1, xiForm2, tipRoll2: l2,
    rb1: g1.rb, rb2: g2.rb,
  };
}
