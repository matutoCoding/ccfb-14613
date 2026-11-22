/**
 * 页面 3:装配误差 —— 轴线平行度/交错度/中心距偏差/锥齿轮安装距/箱体变形附加偏斜。
 */
import { el, fieldRow } from '../dom';
import { db, uid } from '../../db/db';
import type { AssemblyError } from '../../core/types';
import { getSelection, setSelection } from '../state';

function defaultAsm(pairId: string): AssemblyError {
  return {
    id: uid(), name: '装配实测', pairId,
    centerDistance: 0, parallelism: 0, skew: 0,
    housingParallelism: 0, housingSkew: 0,
    mountingPinion: 0, mountingGear: 0,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

const DEFS: [keyof AssemblyError, string, string][] = [
  ['centerDistance', '中心距偏差 Δa(正=拉大)', 'μm'],
  ['parallelism', '轴线平行度 fx(中心距平面内,全齿宽)', 'μm'],
  ['skew', '轴线交错度 fy(垂直平面,全齿宽)', 'μm'],
  ['housingParallelism', '箱体变形附加平行度偏斜', 'μm'],
  ['housingSkew', '箱体变形附加交错偏斜', 'μm'],
  ['mountingPinion', '小轮安装距偏差(锥齿轮,正=远离锥顶)', 'μm'],
  ['mountingGear', '大轮安装距偏差(锥齿轮)', 'μm'],
];

export async function renderAssemblyPage(root: HTMLElement): Promise<void> {
  const pairs = await db.pairs.list();
  const sel = getSelection();
  const pair = pairs.find((p) => p.id === sel.pairId) ?? pairs[0];
  if (!pair) {
    root.append(el('div', { class: 'panel' }, ['请先在「齿轮副」页创建并保存一个齿轮副。']));
    return;
  }
  const asms = await db.assemblies.listFor(pair.id);
  let current: AssemblyError = asms.find((a) => a.id === sel.assemblyId) ?? asms[0] ?? defaultAsm(pair.id);

  const panel = el('div', { class: 'panel' });
  panel.append(el('h2', {}, [`装配误差录入 —— ${pair.name}${pair.type === 'bevel' ? '(锥齿轮)' : ''}`]));

  const asmSel = el('select', { class: 'sel' });
  const rebuildSel = (): void => {
    asmSel.innerHTML = '';
    for (const a of asms) asmSel.append(el('option', { value: a.id }, [a.name]));
    asmSel.value = current.id;
  };
  rebuildSel();
  asmSel.onchange = async () => {
    const a = await db.assemblies.get(asmSel.value);
    if (a) { current = a; fill(); }
  };
  const newBtn = el('button', {}, ['新建记录']);
  newBtn.onclick = () => { current = defaultAsm(pair.id); fill(); };

  const nameInput = el('input', { type: 'text', value: current.name });
  const inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  const formBox = el('div');
  for (const [key, label, unit] of DEFS) {
    const { row, input } = fieldRow({ key, label, unit }, current[key] as number);
    inputs[key] = input;
    formBox.append(row);
  }
  panel.append(
    el('div', { class: 'toolbar' }, [asmSel, newBtn]),
    el('div', { class: 'field-row' }, [el('label', {}, ['记录名称']), nameInput]),
    formBox,
    el('div', { class: 'note' }, [
      '方向约定:平行度 fx 在中心距平面内,正 = 右端中心距增大(接触区偏向左端);',
      '交错度 fy 垂直于中心距平面,正 = 右端间隙增大(接触区偏向左端);',
      '箱体变形附加偏斜与对应轴线误差代数叠加。锥齿轮安装距偏差自动折算为当量中心距与交错误差。',
    ]),
  );

  const fill = (): void => {
    nameInput.value = current.name;
    for (const [key] of DEFS) {
      const inp = inputs[key];
      if (inp) inp.value = String(current[key] ?? 0);
    }
  };

  const saveBtn = el('button', { class: 'primary' }, ['保存记录']);
  saveBtn.onclick = async () => {
    current = {
      ...current,
      name: nameInput.value || '装配实测',
      centerDistance: parseFloat(inputs.centerDistance.value) || 0,
      parallelism: parseFloat(inputs.parallelism.value) || 0,
      skew: parseFloat(inputs.skew.value) || 0,
      housingParallelism: parseFloat(inputs.housingParallelism.value) || 0,
      housingSkew: parseFloat(inputs.housingSkew.value) || 0,
      mountingPinion: parseFloat(inputs.mountingPinion.value) || 0,
      mountingGear: parseFloat(inputs.mountingGear.value) || 0,
      updatedAt: Date.now(),
    };
    await db.assemblies.put(current);
    if (!asms.find((a) => a.id === current.id)) asms.push(current);
    rebuildSel();
    setSelection({ assemblyId: current.id });
    saveBtn.textContent = '已保存 ✓';
    setTimeout(() => { saveBtn.textContent = '保存记录'; }, 1200);
  };
  const delBtn = el('button', { class: 'danger' }, ['删除记录']);
  delBtn.onclick = async () => { await db.assemblies.delete(current.id); location.reload(); };
  panel.append(el('div', { class: 'toolbar' }, [saveBtn, delBtn]));

  root.append(panel);
  fill();
}
