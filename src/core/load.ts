/**
 * 加载接触分析(简化柔度模型):
 * 沿齿向各截面线接触刚度 c′ 相同,刚体贴近量 δ 使 Σ c′·max(0,δ−g)·dz = 法向载荷。
 * 输出载荷分布、赫兹应力、齿端应力集中标记、满载斑点。
 */
import type { LoadedContactResult } from './types';
import type { TcaInput, GapFieldOut } from './tca';

const C_PRIME = 20; // 单对齿啮合刚度 N/(mm·μm), ISO 6336 典型值
const E_MOD = 2.06e5; // 弹性模量 MPa

export function loadedContact(
  inp: TcaInput,
  field: GapFieldOut,
  torqueNm: number,
): LoadedContactResult {
  const { nFace: nF, nProfile: nP, gap } = field;
  // 法向力(沿啮合线) = 转矩 / 基圆半径
  const Fn = (torqueNm * 1000) / inp.rb1; // N
  const dz = inp.faceWidth / nF;

  // 取啮合中点截线 g(t) 做载荷分布(工程简化)
  const jMid = Math.floor(nP / 2);
  const gLine = new Float32Array(nF);
  for (let i = 0; i < nF; i++) gLine[i] = gap[i * nP + jMid];

  // 二分求贴近量 δ (μm)
  let lo = -50, hi = 500;
  const loadAt = (delta: number): number => {
    let sum = 0;
    for (let i = 0; i < nF; i++) sum += C_PRIME * Math.max(0, delta - gLine[i]) * dz;
    return sum;
  };
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (loadAt(mid) < Fn) lo = mid; else hi = mid;
  }
  const delta = (lo + hi) / 2;

  const w = new Float32Array(nF);
  for (let i = 0; i < nF; i++) w[i] = C_PRIME * Math.max(0, delta - gLine[i]);

  // 赫兹应力 pH = sqrt( w·E / (2π·ρ_eq) ), ρ_eq 取节点当量曲率半径
  const alphaT1 = inp.mesh.alphaT1;
  const rho1 = inp.rb1 * Math.tan(alphaT1);
  const rho2 = inp.rb2 * Math.tan(alphaT1);
  const rhoEq = (rho1 * rho2) / (rho1 + rho2);
  let maxStress = 0, maxPos = 0;
  const stress = new Float32Array(nF);
  for (let i = 0; i < nF; i++) {
    stress[i] = Math.sqrt((w[i] * E_MOD) / (2 * Math.PI * rhoEq));
    if (stress[i] > maxStress) { maxStress = stress[i]; maxPos = i / (nF - 1); }
  }

  // 齿端应力集中:端部 15% 区域内应力超过接触区平均 1.5 倍
  let wSum = 0, wCnt = 0;
  for (let i = 0; i < nF; i++) if (w[i] > 0) { wSum += w[i]; wCnt++; }
  const wAvg = wCnt > 0 ? wSum / wCnt : 0;
  const edge = new Uint8Array(nF);
  const edgeN = Math.max(1, Math.round(nF * 0.15));
  for (let i = 0; i < nF; i++) {
    const isEdge = i < edgeN || i >= nF - edgeN;
    if (isEdge && wAvg > 0 && w[i] > 1.5 * wAvg) edge[i] = 1;
  }

  // 满载斑点:间隙 ≤ δ 即接触
  const maskFullLoad = new Uint8Array(nF * nP);
  for (let i = 0; i < nF; i++)
    for (let j = 0; j < nP; j++)
      maskFullLoad[i * nP + j] = gap[i * nP + j] <= delta ? 1 : 0;

  return { loadPerLength: w, maxStress, maxStressPos: maxPos, edgeStressFlags: edge, maskFullLoad };
}
