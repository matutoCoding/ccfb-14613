/**
 * 页面 1:齿轮副 —— 参数录入、几何计算(含锥齿轮格里森制)、三维齿面预览。
 */
import { el, fieldRow, fmt } from '../dom';
import { db, uid } from '../../db/db';
import type { GearPairParams, GearParams } from '../../core/types';
import { gearGeometry, meshGeometry, DEG } from '../../core/involute';
import { bevelGeometry } from '../../core/bevel';
import { getSelection, setSelection } from '../state';
import { ToothViewer } from '../viewer3d';

const DEFAULT_PINION: GearParams = {
  module: 4, teeth: 21, pressureAngle: 20, helixAngle: 18, hand: 'RH',
  profileShift: 0.25, faceWidth: 60, backlash: 80,
};
const DEFAULT_GEAR: GearParams = {
  module: 4, teeth: 79, pressureAngle: 20, helixAngle: 18, hand: 'LH',
  profileShift: -0.1, faceWidth: 56, backlash: 80,
};

function gearFields(prefix: string, g: GearParams): { box: HTMLElement; read: () => GearParams } {
  const defs: [keyof GearParams, string, string?][] = [
    ['module', '法向模数', 'mm'],
    ['teeth', '齿数'],
    ['pressureAngle', '法向压力角', '°'],
    ['helixAngle', '螺旋角', '°'],
    ['profileShift', '变位系数 x'],
    ['faceWidth', '齿宽', 'mm'],
    ['backlash', '法向侧隙', 'μm'],
  ];
  const box = el('div', { class: 'grow' });
  box.append(el('h3', {}, [prefix]));
  const inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  for (const [key, label, unit] of defs) {
    const { row, input } = fieldRow({ key: `${prefix}${key}`, label, unit }, g[key] as number);
    inputs[key] = input;
    box.append(row);
  }
  const { row: handRow, input: handSel } = fieldRow(
    { key: `${prefix}hand`, label: '旋向', type: 'select', options: [['RH', '右旋'], ['LH', '左旋']] },
    g.hand,
  );
  inputs.hand = handSel;
  box.append(handRow);
  const read = (): GearParams => ({
    module: parseFloat(inputs.module.value) || 1,
    teeth: Math.round(parseFloat(inputs.teeth.value)) || 1,
    pressureAngle: parseFloat(inputs.pressureAngle.value) || 20,
    helixAngle: parseFloat(inputs.helixAngle.value) || 0,
    hand: (inputs.hand.value === 'LH' ? 'LH' : 'RH'),
    profileShift: parseFloat(inputs.profileShift.value) || 0,
    faceWidth: parseFloat(inputs.faceWidth.value) || 10,
    backlash: parseFloat(inputs.backlash.value) || 0,
  });
  return { box, read };
}

export async function renderGearsPage(root: HTMLElement): Promise<void> {
  const pairs = await db.pairs.list();
  const sel = getSelection();
  let current: GearPairParams = pairs.find((p) => p.id === sel.pairId) ?? {
    id: uid(), name: '新齿轮副', type: 'cylindrical',
    pinion: { ...DEFAULT_PINION }, gear: { ...DEFAULT_GEAR },
    bevel: { shaftAngle: 90, spiralAngle: 35 },
    createdAt: Date.now(), updatedAt: Date.now(),
  };

  // --- 列表 ---
  const listPanel = el('div', { class: 'panel' });
  listPanel.append(el('h2', {}, ['已存齿轮副']));
  const table = el('table', { class: 'data' });
  table.append(el('tr', {}, [el('th', {}, ['名称']), el('th', {}, ['类型']), el('th', {}, ['z1/z2']), el('th', {}, ['模数']), el('th', {}, [''])]));
  for (const p of pairs) {
    const openBtn = el('button', {}, ['打开']);
    openBtn.onclick = () => { setSelection({ pairId: p.id }); location.hash = '#/gears'; location.reload(); };
    const delBtn = el('button', { class: 'danger' }, ['删']);
    delBtn.onclick = async () => { await db.pairs.delete(p.id); location.reload(); };
    table.append(el('tr', {}, [
      el('td', {}, [p.name]),
      el('td', {}, [p.type === 'bevel' ? '锥齿轮' : '圆柱齿轮']),
      el('td', {}, [`${p.pinion.teeth}/${p.gear.teeth}`]),
      el('td', {}, [fmt(p.pinion.module)]),
      el('td', {}, [openBtn, delBtn]),
    ]));
  }
  listPanel.append(table);

  // --- 编辑器 ---
  const editPanel = el('div', { class: 'panel' });
  editPanel.append(el('h2', {}, ['参数编辑']));
  const nameInput = el('input', { type: 'text', value: current.name });
  editPanel.append(el('div', { class: 'field-row' }, [el('label', {}, ['名称']), nameInput]));
  const typeSel = el('select', { class: 'sel' }, [
    el('option', { value: 'cylindrical' }, ['圆柱齿轮(斜齿/直齿)']),
    el('option', { value: 'bevel' }, ['锥齿轮(格里森制)']),
  ]);
  typeSel.value = current.type;
  editPanel.append(el('div', { class: 'field-row' }, [el('label', {}, ['类型']), typeSel]));

  const pF = gearFields('小轮', current.pinion);
  const gF = gearFields('大轮', current.gear);
  const cols = el('div', { class: 'cols' }, [pF.box, gF.box]);
  editPanel.append(cols);

  // 锥齿轮参数
  const bevelBox = el('div');
  const shaftIn = el('input', { type: 'number', step: 'any', value: String(current.bevel?.shaftAngle ?? 90) });
  const spiralIn = el('input', { type: 'number', step: 'any', value: String(current.bevel?.spiralAngle ?? 35) });
  bevelBox.append(
    el('h3', {}, ['锥齿轮(格里森制)参数']),
    el('div', { class: 'field-row' }, [el('label', {}, ['轴交角 (°)']), shaftIn]),
    el('div', { class: 'field-row' }, [el('label', {}, ['中点螺旋角 (°)']), spiralIn]),
    el('div', { class: 'note' }, ['锥齿轮模数按大端端面模数录入;仿真时自动换算为中点当量圆柱齿轮副。']),
  );
  const toggleBevel = (): void => { bevelBox.style.display = typeSel.value === 'bevel' ? '' : 'none'; };
  typeSel.onchange = toggleBevel;
  toggleBevel();
  editPanel.append(bevelBox);

  // --- 几何计算结果 ---
  const geomPanel = el('div', { class: 'panel' });
  geomPanel.append(el('h2', {}, ['几何计算']));

  // --- 三维预览 ---
  const viewPanel = el('div', { class: 'panel grow' });
  viewPanel.append(el('h2', {}, ['齿面三维预览(含齿根过渡曲线)']));
  const viewerBox = el('div', { class: 'viewer-box' });
  const previewSel = el('select', { class: 'sel' }, [
    el('option', { value: 'pinion' }, ['小轮']), el('option', { value: 'gear' }, ['大轮']),
  ]);
  viewPanel.append(el('div', { class: 'toolbar' }, [previewSel]));
  viewPanel.append(viewerBox);
  const viewer = new ToothViewer(viewerBox);

  const computeGeom = (): GearPairParams => {
    const pair: GearPairParams = {
      ...current,
      name: nameInput.value || '未命名',
      type: typeSel.value === 'bevel' ? 'bevel' : 'cylindrical',
      pinion: pF.read(),
      gear: gF.read(),
      bevel: { shaftAngle: parseFloat(shaftIn.value) || 90, spiralAngle: parseFloat(spiralIn.value) || 35 },
      updatedAt: Date.now(),
    };
    return pair;
  };

  const refresh = (): void => {
    const pair = computeGeom();
    const g1 = gearGeometry(pair.pinion);
    const g2 = gearGeometry(pair.gear);
    const rows: [string, string][] = [];
    if (pair.type === 'bevel') {
      const bg = bevelGeometry(pair);
      rows.push(
        ['小轮分锥角 δ1', fmt(bg.delta1 / DEG, 3) + '°'],
        ['大轮分锥角 δ2', fmt(bg.delta2 / DEG, 3) + '°'],
        ['外锥距 R', fmt(bg.R) + ' mm'],
        ['中点锥距 Rm', fmt(bg.Rm) + ' mm'],
        ['中点法向模数 mmn', fmt(bg.mm, 3) + ' mm'],
        ['当量齿数 zv1/zv2', `${fmt(bg.zv1, 1)} / ${fmt(bg.zv2, 1)}`],
      );
    }
    const mesh = meshGeometry(g1, g2, pair.centerDistance);
    const eps = (mesh.xiMax - mesh.xiMin) / g1.pbt;
    rows.push(
      ['小轮基圆直径', fmt(g1.rb * 2, 3) + ' mm'],
      ['大轮基圆直径', fmt(g2.rb * 2, 3) + ' mm'],
      ['理论中心距', fmt(g1.r + g2.r, 3) + ' mm'],
      ['啮合角(端面)', fmt(mesh.alphaT1 / DEG, 3) + '°'],
      ['端面重合度(近似)', fmt(eps, 2)],
      ['端面基节', fmt(g1.pbt, 3) + ' mm'],
    );
    geomPanel.innerHTML = '<h2>几何计算</h2>';
    const t = el('table', { class: 'data' });
    for (const [k, v] of rows) t.append(el('tr', {}, [el('td', {}, [k]), el('td', {}, [v])]));
    geomPanel.append(t);
    viewer.showTooth(previewSel.value === 'gear' ? pair.gear : pair.pinion, null);
  };
  previewSel.onchange = refresh;

  const saveBtn = el('button', { class: 'primary' }, ['保存齿轮副']);
  saveBtn.onclick = async () => {
    current = computeGeom();
    await db.pairs.put(current);
    setSelection({ pairId: current.id });
    location.reload();
  };
  const refreshBtn = el('button', {}, ['计算/预览']);
  refreshBtn.onclick = refresh;
  editPanel.append(el('div', { class: 'toolbar' }, [saveBtn, refreshBtn]));

  root.append(
    el('div', { class: 'cols' }, [el('div', { class: 'grow' }, [listPanel, editPanel, geomPanel]), viewPanel]),
  );
  refresh();
}
