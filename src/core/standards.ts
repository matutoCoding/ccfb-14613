/**
 * 国标接触斑点判定(GB/T 10095 接触斑点要求,典型值,可在界面调整)。
 * 按齿高方向 h_c/H 与齿长方向 b_c/B 双指标,取较低等级。
 */
import type { GradeJudgement } from './types';

export interface GradeRow {
  grade: number;
  heightPct: number; // 按高度不小于 %
  lengthPct: number; // 按长度不小于 %
}

/** 默认表(渐开线圆柱齿轮,典型值;用户可在对比页编辑) */
export const DEFAULT_GRADE_TABLE: GradeRow[] = [
  { grade: 5, heightPct: 55, lengthPct: 80 },
  { grade: 6, heightPct: 50, lengthPct: 70 },
  { grade: 7, heightPct: 45, lengthPct: 60 },
  { grade: 8, heightPct: 40, lengthPct: 50 },
  { grade: 9, heightPct: 30, lengthPct: 40 },
  { grade: 10, heightPct: 25, lengthPct: 35 },
  { grade: 11, heightPct: 20, lengthPct: 30 },
  { grade: 12, heightPct: 15, lengthPct: 25 },
];

export function judgeGrade(
  heightPct: number,
  lengthPct: number,
  targetGrade: number,
  table: GradeRow[] = DEFAULT_GRADE_TABLE,
): GradeJudgement {
  const row = table.find((r) => r.grade === targetGrade) ?? table[table.length - 1];
  const pass = heightPct >= row.heightPct && lengthPct >= row.lengthPct;
  // 实际达到的最高等级
  let achieved = 0;
  for (const r of table) {
    if (heightPct >= r.heightPct && lengthPct >= r.lengthPct) { achieved = r.grade; break; }
  }
  return {
    grade: achieved,
    requiredHeightPct: row.heightPct,
    requiredLengthPct: row.lengthPct,
    pass,
  };
}
