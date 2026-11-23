import type { Vec3 } from './types';

export const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const normalize = (a: Vec3): Vec3 => {
  const n = norm(a);
  return n < 1e-15 ? { x: 0, y: 0, z: 0 } : scale(a, 1 / n);
};
/** 绕单位轴 k 旋转向量 a, 角度 theta (Rodrigues) */
export function rotAxis(a: Vec3, k: Vec3, theta: number): Vec3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return add(add(scale(a, c), scale(cross(k, a), s)), scale(k, dot(k, a) * (1 - c)));
}
/** 绕 z 轴旋转 */
export function rotZ(a: Vec3, theta: number): Vec3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c, z: a.z };
}
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 角度工具 */
export const deg2rad = (d: number): number => (d * Math.PI) / 180;
export const rad2deg = (r: number): number => (r * 180) / Math.PI;

/** 数值雅可比: f: R^m -> R^n, 前向差分 */
export function jacobian(f: (x: number[]) => number[], x: number[], eps = 1e-6): number[][] {
  const f0 = f(x);
  const n = f0.length;
  const m = x.length;
  const J: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let j = 0; j < m; j++) {
    const xp = x.slice();
    const h = Math.max(1e-9, Math.abs(x[j]) * eps);
    xp[j] += h;
    const fp = f(xp);
    for (let i = 0; i < n; i++) J[i][j] = (fp[i] - f0[i]) / h;
  }
  return J;
}

/** 解 A x = b, A 为 n×n 方阵 (Gauss 消元 + 部分主元) */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-18) throw new Error('奇异矩阵, 无法求解');
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col + 1; c <= n; c++) M[r][c] -= f * M[col][c];
      M[r][col] = 0;
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** 最小二乘 min ||J x - r||, J 为 m×n (m>=n), 返回 x */
export function leastSquares(J: number[][], r: number[]): number[] {
  const m = J.length;
  const n = J[0].length;
  const JtJ: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const Jtr: number[] = new Array(n).fill(0);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += J[k][a] * J[k][b];
      JtJ[a][b] = s;
    }
    let s = 0;
    for (let k = 0; k < m; k++) s += J[k][a] * r[k];
    Jtr[a] = s;
  }
  // 轻度岭回归保证数值稳定
  const trace = JtJ.reduce((acc, row, i) => acc + row[i], 0) / n;
  const lambda = trace * 1e-10;
  for (let i = 0; i < n; i++) JtJ[i][i] += lambda;
  return solveLinear(JtJ, Jtr);
}
