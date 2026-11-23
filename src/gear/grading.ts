/**
 * 接触斑点精度评级
 * 依据 GB/T 13672(圆柱齿轮装配)/ISO 1328 接触斑点指导值的工程常用判据:
 * 按齿宽方向接触长度占比与齿高方向接触高度占比评定等级
 * (表中数值为工程常用参考值, 企业可在设置中覆盖)
 */
import type { ContactPattern } from './tca';

export interface GradeRule {
  grade: number;
  label: string;
  /** 齿宽方向最小接触占比 */
  minLength: number;
  /** 齿高方向最小接触占比 */
  minHeight: number;
}

/** 默认等级表 (5~10 级, 数值为占比下限) */
export const DEFAULT_GRADE_TABLE: GradeRule[] = [
  { grade: 5, label: '5 级(精密)', minLength: 0.85, minHeight: 0.70 },
  { grade: 6, label: '6 级(高精度)', minLength: 0.80, minHeight: 0.60 },
  { grade: 7, label: '7 级(较高精度)', minLength: 0.70, minHeight: 0.50 },
  { grade: 8, label: '8 级(中等精度)', minLength: 0.60, minHeight: 0.40 },
  { grade: 9, label: '9 级(一般精度)', minLength: 0.45, minHeight: 0.30 },
  { grade: 10, label: '10 级(低精度)', minLength: 0.30, minHeight: 0.20 },
];

export interface GradeResult {
  /** 评定达到的最高等级(数字越小越好); 达不到 10 级返回 11 */
  grade: number;
  label: string;
  pass: boolean;
  /** 要求达到的等级 */
  requiredGrade: number;
  lengthFraction: number;
  heightFraction: number;
  /** 不接触/偏载诊断 */
  diagnosis: string;
}

export function evaluatePattern(
  pattern: ContactPattern,
  requiredGrade = 8,
  table: GradeRule[] = DEFAULT_GRADE_TABLE,
): GradeResult {
  const l = pattern.lengthFraction;
  const h = pattern.heightFraction;
  const sorted = [...table].sort((a, b) => a.grade - b.grade);
  let reached = sorted[sorted.length - 1];
  for (const rule of sorted) {
    if (l >= rule.minLength && h >= rule.minHeight) {
      reached = rule;
      break;
    }
  }
  const meetsAll = l >= reached.minLength && h >= reached.minHeight;
  const diagnosisParts: string[] = [];
  if (l < 0.3) diagnosisParts.push('齿宽方向接触过短, 存在偏载/轴线平行度问题');
  if (h < 0.2) diagnosisParts.push('齿高方向接触过窄, 检查齿顶修缘与中心距');
  if (Math.abs(pattern.offsetZ) > (pattern.zeta[pattern.zeta.length - 1] - pattern.zeta[0]) * 0.25) {
    diagnosisParts.push(`斑点偏向齿端(偏移 ${pattern.offsetZ.toFixed(2)} mm)`);
  }
  if (Math.abs(pattern.tiltAngle) > 0.15) diagnosisParts.push('接触线倾斜, 螺旋角/交错度异常');
  if (diagnosisParts.length === 0) diagnosisParts.push('接触形态正常');

  return {
    grade: meetsAll ? reached.grade : 11,
    label: meetsAll ? reached.label : '低于 10 级',
    pass: meetsAll && reached.grade <= requiredGrade,
    requiredGrade,
    lengthFraction: l,
    heightFraction: h,
    diagnosis: diagnosisParts.join('; '),
  };
}
