/**
 * 领域模型定义
 * 单位约定: 长度 mm, 角度内部一律 rad (UI 层负责度<->弧度转换), 修形量 μm
 */

export type GearKind = 'cylindrical' | 'bevel';
export type HelixHand = 'left' | 'right';
export type FlankSide = 'working' | 'nonworking';

/** 锥齿轮(格里森制)基本参数 */
export interface BevelParams {
  /** 轴交角 Σ (rad), 常用 90° */
  shaftAngle: number;
  /** 中点螺旋角 (rad), 直齿锥齿轮取 0 */
  spiralAngle: number;
  /** 分锥角 δ (rad), 可由配对手齿数比自动计算 */
  pitchAngle: number;
  /** 外锥距(节锥母线长) R (mm) */
  outerConeDistance: number;
  /** 安装距(基准面到节锥顶点) (mm) */
  mountingDistance: number;
  /** 顶隙系数 */
  clearanceCoef: number;
}

export interface GearParams {
  id: string;
  name: string;
  kind: GearKind;
  /** 法向模数 mn (mm) */
  module: number;
  /** 齿数 z */
  teeth: number;
  /** 法向压力角 αn (rad) */
  pressureAngle: number;
  /** 分度圆螺旋角 β (rad), 直齿 = 0 */
  helixAngle: number;
  /** 旋向 */
  hand: HelixHand;
  /** 法向变位系数 x */
  profileShift: number;
  /** 齿宽 b (mm) */
  faceWidth: number;
  /** 齿顶高系数 ha* (默认 1) */
  addendumCoef: number;
  /** 顶隙系数 c* (默认 0.25) */
  clearanceCoef: number;
  /** 锥齿轮专用参数 (kind=bevel 时必填) */
  bevel?: BevelParams;
}

export interface GearPair {
  id: string;
  name: string;
  updatedAt: number;
  pinion: GearParams;
  gear: GearParams;
  /** 名义中心距 (mm), 圆柱齿轮可自动计算; 0 表示自动 */
  nominalCenterDistance: number;
  /** 齿侧间隙(侧隙) (mm) */
  backlash: number;
}

/** 装配误差输入 (角度 rad, 长度 mm) */
export interface AssemblyError {
  id: string;
  name: string;
  updatedAt: number;
  pairId: string;
  /** 中心距偏差 Δa (mm) */
  centerDistanceError: number;
  /** 轴线平行度偏差: 中心平面内(垂直方向) fΣβ, 正号使主动轮大端/齿向上端接触 (rad) */
  parallelismInPlane: number;
  /** 轴线平行度偏差: 垂直平面内(交错方向) fΣδ (rad) */
  parallelismCross: number;
  /** 锥齿轮小轮安装距偏差 ΔM1 (mm) */
  pinionMountingError: number;
  /** 锥齿轮大轮安装距偏差 ΔM2 (mm) */
  gearMountingError: number;
  /** 轴交角偏差 ΔΣ (rad) */
  shaftAngleError: number;
  /** 箱体载荷: 额定扭矩 (N·m), 用于估算附加偏斜 */
  housingTorque: number;
  /** 箱体偏斜刚度 (N·m/rad), 越大越刚; Infinity 表示不附加 */
  housingStiffness: number;
}

/** 载荷工况 */
export interface LoadCase {
  /** 小轮扭矩 N·m */
  torqueNm: number;
  /** 转速 rpm (仅啮合频率用) */
  rpm: number;
  /** 弹性模量 MPa (钢 2.06e5) */
  elasticModulus: number;
  /** 泊松比 */
  poissonRatio: number;
  /** 许用接触应力 MPa */
  allowableStress: number;
}

export const DEFAULT_LOAD: LoadCase = {
  torqueNm: 500,
  rpm: 1500,
  elasticModulus: 2.06e5,
  poissonRatio: 0.3,
  allowableStress: 1200,
};

/** 三维点 / 向量 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 齿面参数网格上的一个采样点 */
export interface SurfacePoint {
  /** 位置 (齿轮坐标系, 轴线 = z) */
  p: Vec3;
  /** 单位法向(指向齿外) */
  n: Vec3;
  /** 参数: 半径 r (mm) */
  r: number;
  /** 轴向坐标 z (mm) */
  z: number;
}

export interface SurfaceGrid {
  points: SurfacePoint[];
  /** 径向(齿高方向)格数 */
  nR: number;
  /** 轴向(齿宽方向)格数 */
  nZ: number;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
