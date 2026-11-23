/**
 * 仿真记录与照片记录的数据结构
 */
import type { FlankSide } from '../gear/types';
import type { PatternFeatures } from '../gear/inverse';

export interface SimulationRecord {
  id: string;
  name: string;
  createdAt: number;
  pairId: string;
  planId: string;
  assemblyId: string;
  side: FlankSide;
  /** 间隙场快照 (mm), 行优先 nS×nZ */
  clearance: number[];
  /** 着色强度场 0..1 */
  intensity: number[];
  /** 满载压力场 MPa */
  pressureFull: number[];
  /** 轻载压力场 MPa */
  pressureLight: number[];
  nS: number;
  nZ: number;
  sAxis: number[];
  zAxis: number[];
  /** TE 曲线点 */
  te: { theta1: number; te: number }[];
  tePeakToPeak: number;
  teMeshAmplitude: number;
  maxStress: number;
  loadDistributionFactor: number;
  redZones: number[];
  features: PatternFeatures;
}

export interface PhotoRecord {
  id: string;
  name: string;
  createdAt: number;
  pairId: string;
  /** 原图 dataURL (JPEG/PNG) */
  imageDataUrl: string;
  width: number;
  height: number;
  /** 四角标定: 图像像素 -> 齿面归一化坐标 (ζ,ρ) */
  calibration: {
    px: number;
    py: number;
    zeta: number;
    rho: number;
  }[];
  /** 提取的斑点特征 */
  features: PatternFeatures | null;
  /** 反推得到的装配误差 */
  inferredErrors: Record<string, number> | null;
}
