import { describe, it, expect } from 'vitest';
import { derivePair } from '../src/gear/pair';
import { effectiveErrors } from '../src/gear/assembly';
import { buildGrid } from '../src/gear/tca';
import { runLoadedCases, totalNormalForce, solveLoaded } from '../src/gear/loaded';
import { defaultPlan } from '../src/gear/modification';
import { DEFAULT_LOAD } from '../src/gear/types';
import { helicalPair, zeroErrors } from './fixtures';

describe('加载接触分析 LTCA', () => {
  it('满载压力高于轻载, 总法向力与扭矩换算一致', () => {
    const pair = helicalPair();
    const derived = derivePair(pair);
    const plan = defaultPlan(pair.id, 'p');
    const grid = buildGrid(
      derived,
      plan,
      'working',
      effectiveErrors(pair, derived, zeroErrors(pair.id)),
      { nS: 40, nZ: 40 },
    );
    const cases = runLoadedCases(derived, grid, DEFAULT_LOAD);
    const maxLight = Math.max(...cases.light.pressure);
    const maxFull = Math.max(...cases.full.pressure);
    expect(maxFull).toBeGreaterThan(maxLight);
    // 轻载=25% 扭矩, 力也应约为 1/4
    const fFull = totalNormalForce(derived, DEFAULT_LOAD.torqueNm);
    const fLight = totalNormalForce(derived, DEFAULT_LOAD.torqueNm * 0.25);
    expect(fLight / fFull).toBeCloseTo(0.25, 5);
    // 理想工况载荷均布, Kβ 接近 1
    expect(cases.full.loadDistributionFactor).toBeLessThan(1.05);
  });

  it('交错偏斜下 Kβ 增大且出现齿端应力集中红区', () => {
    const pair = helicalPair();
    const derived = derivePair(pair);
    const plan = defaultPlan(pair.id, 'p');
    const asm = zeroErrors(pair.id);
    asm.parallelismCross = 0.0008;
    const grid = buildGrid(derived, plan, 'working', effectiveErrors(pair, derived, asm), { nS: 40, nZ: 40 });
    const full = solveLoaded(derived, grid, DEFAULT_LOAD, totalNormalForce(derived, DEFAULT_LOAD.torqueNm));
    expect(full.loadDistributionFactor).toBeGreaterThan(1.3);
    expect(full.redZones.length).toBeGreaterThan(0);
  });
});
