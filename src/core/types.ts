/**
 * 全局数据模型 —— 所有单位约定:
 * 长度: mm;角度: 度(界面层) / 弧度(计算层,函数内转换);
 * 修形量、间隙、误差: μm(微米),计算时换算成 mm。
 */

export type GearHand = 'RH' | 'LH';

/** 圆柱齿轮基本参数(法向) */
export interface GearParams {
  module: number;        // 法向模数 mn (mm)
  teeth: number;         // 齿数 z
  pressureAngle: number; // 法向压力角 αn (deg)
  helixAngle: number;    // 分度圆螺旋角 β (deg), 0 = 直齿
  hand: GearHand;        // 旋向
  profileShift: number;  // 变位系数 x
  faceWidth: number;     // 齿宽 B (mm)
  tipDiameter?: number;  // 齿顶圆直径 da (mm), 缺省按标准顶隙
  rootDiameter?: number; // 齿根圆直径 df (mm)
  backlash: number;      // 法向侧隙 jn (μm), 均分到两齿面
}

/** 锥齿轮(格里森制)附加参数 */
export interface BevelParams {
  shaftAngle: number;    // 轴交角 Σ (deg), 通常 90
  spiralAngle: number;   // 中点螺旋角 βm (deg), 格里森常用 35
  faceContactRatio?: number;
}

export interface GearPairParams {
  id: string;
  name: string;
  type: 'cylindrical' | 'bevel';
  pinion: GearParams;
  gear: GearParams;
  /** 实际装配中心距 (mm), 缺省 = 理论中心距 */
  centerDistance?: number;
  bevel?: BevelParams;
  createdAt: number;
  updatedAt: number;
}

/** 齿面修形方案 */
export interface ModificationSpec {
  id: string;
  name: string;
  pairId: string;
  target: 'pinion' | 'gear';
  /** 齿向鼓形量 (μm, 齿宽中点最大) */
  crowning: number;
  /** 齿端修薄: 量 (μm) 与每端长度 (mm) */
  endReliefAmount: number;
  endReliefLength: number;
  /** 齿顶修缘: 量 (μm) 与起始点(滚动路径, 距单齿根啮合点的比例 0..1) */
  tipReliefAmount: number;
  tipReliefStart: number; // 0=齿根侧有效渐开线起点, 1=齿顶
  /** 齿形鼓形(沿齿廓) (μm) */
  profileCrowning: number;
  /** 螺旋角修正 (μm, 沿全齿宽线性, 正=右端减薄) */
  helixCorrection: number;
  /** 自由拓扑网格 (μm), rows=齿向, cols=齿廓; 存在时叠加 */
  topology?: number[][];
  createdAt: number;
  updatedAt: number;
}

/** 装配误差(μm, 沿齿宽为斜率量的均指"全齿宽上的总量") */
export interface AssemblyError {
  id: string;
  name: string;
  pairId: string;
  centerDistance: number;   // 中心距偏差 Δa (μm, 正=拉大)
  parallelism: number;      // 轴线平行度(中心距平面内) fx (μm / 全齿宽)
  skew: number;             // 轴线交错度(垂直平面) fy (μm / 全齿宽)
  /** 箱体受载变形附加偏斜 */
  housingParallelism: number; // (μm / 全齿宽)
  housingSkew: number;        // (μm / 全齿宽)
  /** 锥齿轮安装距偏差 (μm, 正=远离锥顶) */
  mountingPinion: number;
  mountingGear: number;
  createdAt: number;
  updatedAt: number;
}

/** 仿真设置 */
export interface SimSettings {
  faceSections: number;   // 齿向截面数
  profileSamples: number; // 齿廓采样数
  rotationSteps: number;  // 每转步数
  paintThickness: number; // 红丹层厚 (μm)
  torque: number;         // 载荷扭矩 (N·m, 小轮)
}

export const DEFAULT_SIM_SETTINGS: SimSettings = {
  faceSections: 51,
  profileSamples: 101,
  rotationSteps: 240,
  paintThickness: 5,
  torque: 100,
};

/** 间隙场 / 斑点结果 */
export interface GapFieldResult {
  /** gap[iFace][iProfile] μm */
  gap: Float32Array;
  nFace: number;
  nProfile: number;
  /** 每个接触坐标处的瞬时最小间隙 G(ξ) μm */
  minGapPerContact: Float32Array;
  /** 斑点掩膜 0/1 */
  mask: Uint8Array;
  /** 传动误差曲线 (μm, 沿啮合线) 每旋转步一个值 */
  transmissionError: Float32Array;
  /** 斑点百分比 */
  patternLengthPct: number; // 沿齿宽 %
  patternHeightPct: number; // 沿齿高 %
  /** 载荷接触(轻载/满载) */
  loaded?: LoadedContactResult;
}

export interface LoadedContactResult {
  /** 单位长度载荷分布 N/mm, 沿齿宽 */
  loadPerLength: Float32Array;
  /** 最大接触应力 MPa 及其齿向位置(0..1) */
  maxStress: number;
  maxStressPos: number;
  /** 齿端应力集中标记 0/1 (沿齿宽) */
  edgeStressFlags: Uint8Array;
  maskFullLoad: Uint8Array;
}

/** 反推结果 */
export interface InvertedError {
  centerDistance: number;
  parallelism: number;
  skew: number;
  mountingPinion: number;
  mountingGear: number;
  residual: number; // 掩膜不一致率 0..1
}

/** 国标接触斑点等级判定 */
export interface GradeJudgement {
  grade: number;        // 判定达到的最高等级 (5..12), 0=不合格
  requiredHeightPct: number;
  requiredLengthPct: number;
  pass: boolean;
}
