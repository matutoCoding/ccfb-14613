/** 全局选择状态(localStorage 记忆) */
const KEY = 'gear-sim-selection';

export interface Selection {
  pairId: string;
  modPinionId: string;
  modGearId: string;
  assemblyId: string;
}

const defaults: Selection = { pairId: '', modPinionId: '', modGearId: '', assemblyId: '' };

export function getSelection(): Selection {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...defaults };
  }
}

export function setSelection(patch: Partial<Selection>): void {
  const s = { ...getSelection(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 忽略 */ }
}
