/**
 * 页面 6:修形报告 —— 导出修形曲线 CSV、磨齿机修形参数表、仿真斑点图。
 */
import { el, fmt, download } from '../dom';
import { db } from '../../db/db';
import { DEFAULT_SIM_SETTINGS } from '../../core/types';
import { getSelection } from '../state';
import { runSimulation } from '../../core/simulate';
import { leadModification, endRelief, profileModification } from '../../core/modification';
import { gearGeometry } from '../../core/involute';
import { paintPattern } from '../patternCanvas';
import { teStats } from '../../core/tca';

export async function renderReportPage(root: HTMLElement): Promise<void> {
  const pairs = await db.pairs.list();
  const sel = getSelection();
  const pair = pairs.find((p) => p.id === sel.pairId) ?? pairs[0];
  if (!pair) {
    root.append(el('div', { class: 'panel' }, ['请先在「齿轮副」页创建并保存一个齿轮副。']));
    return;
  }
  const mods = await db.mods.listFor(pair.id);
  const asms = await db.assemblies.listFor(pair.id);
  const modP = mods.find((m) => m.target === 'pinion') ?? null;
  const modG = mods.find((m) => m.target === 'gear') ?? null;
  const asm = asms[0] ?? null;

  const panel = el('div', { class: 'panel' });
  panel.append(el('h2', {}, [`修形报告 —— ${pair.name}`]));
  const summary = el('div', {});
  panel.append(summary);

  const patternCanvas = el('canvas', { class: 'plot', width: '720', height: '300' });
  const patternPanel = el('div', { class: 'panel' }, [el('h2', {}, ['仿真斑点图']), patternCanvas]);

  const toolbar = el('div', { class: 'toolbar' });
  const genBtn = el('button', { class: 'primary' }, ['生成报告数据']);
  const csvCurveBtn = el('button', {}, ['导出修形曲线 CSV']);
  const csvMachineBtn = el('button', {}, ['导出磨齿机参数表 CSV']);
  const pngBtn = el('button', {}, ['导出斑点图 PNG']);
  const txtBtn = el('button', {}, ['导出完整报告 TXT']);
  csvCurveBtn.disabled = true;
  csvMachineBtn.disabled = true;
  pngBtn.disabled = true;
  txtBtn.disabled = true;
  toolbar.append(genBtn, csvCurveBtn, csvMachineBtn, pngBtn, txtBtn);
  panel.append(toolbar);

  let curveCsv = '', machineCsv = '', reportTxt = '';

  genBtn.onclick = async () => {
    genBtn.disabled = true;
    const settings = { ...DEFAULT_SIM_SETTINGS };
    const sim = await runSimulation(pair, modP, modG, asm, settings, true);
    const r = sim.result;
    const te = teStats(r.transmissionError);
    const g1 = gearGeometry(pair.pinion);
    const g2 = gearGeometry(pair.gear);

    // --- 修形曲线 CSV ---
    const lines = ['t_or_s,lead_mod_um,profile_mod_um'];
    const B = pair.pinion.faceWidth;
    for (let k = 0; k <= 100; k++) {
      const t = k / 100;
      const lead = (modP ? leadModification(modP, t) + endRelief(modP, t, B) : 0)
        + (modG ? leadModification(modG, t) + endRelief(modG, t, pair.gear.faceWidth) : 0);
      const prof = (modP ? profileModification(modP, t) : 0) + (modG ? profileModification(modG, t) : 0);
      lines.push(`${t.toFixed(3)},${lead.toFixed(3)},${prof.toFixed(3)}`);
    }
    curveCsv = lines.join('\n');

    // --- 磨齿机参数表 ---
    const mrows: [string, string, string][] = [
      ['项目', '小轮', '大轮'],
      ['法向模数 mn (mm)', fmt(pair.pinion.module, 3), fmt(pair.gear.module, 3)],
      ['齿数 z', String(pair.pinion.teeth), String(pair.gear.teeth)],
      ['法向压力角 (°)', fmt(pair.pinion.pressureAngle, 3), fmt(pair.gear.pressureAngle, 3)],
      ['螺旋角 (°)', fmt(pair.pinion.helixAngle, 4), fmt(pair.gear.helixAngle, 4)],
      ['变位系数 x', fmt(pair.pinion.profileShift, 4), fmt(pair.gear.profileShift, 4)],
      ['基圆直径 (mm)', fmt(g1.rb * 2, 4), fmt(g2.rb * 2, 4)],
      ['齿向鼓形量 (μm)', fmt(modP?.crowning ?? 0, 1), fmt(modG?.crowning ?? 0, 1)],
      ['齿端修薄量×长度 (μm×mm)', `${fmt(modP?.endReliefAmount ?? 0, 1)}×${fmt(modP?.endReliefLength ?? 0, 1)}`, `${fmt(modG?.endReliefAmount ?? 0, 1)}×${fmt(modG?.endReliefLength ?? 0, 1)}`],
      ['齿顶修缘量 (μm)', fmt(modP?.tipReliefAmount ?? 0, 1), fmt(modG?.tipReliefAmount ?? 0, 1)],
      ['修缘起点(0~1)', fmt(modP?.tipReliefStart ?? 1, 3), fmt(modG?.tipReliefStart ?? 1, 3)],
      ['齿形鼓形量 (μm)', fmt(modP?.profileCrowning ?? 0, 1), fmt(modG?.profileCrowning ?? 0, 1)],
      ['螺旋角修正 (μm/全齿宽)', fmt(modP?.helixCorrection ?? 0, 1), fmt(modG?.helixCorrection ?? 0, 1)],
    ];
    machineCsv = mrows.map((r) => r.join(',')).join('\n');

    // --- 斑点图 ---
    paintPattern(patternCanvas, r.mask, {
      nFace: r.nFace, nProfile: r.nProfile, gap: r.gap,
      paintThickness: settings.paintThickness,
      edgeFlags: r.loaded?.edgeStressFlags,
      title: pair.name,
    });

    // --- 汇总 ---
    summary.innerHTML = '';
    const grid = el('div', { class: 'stat-grid' });
    const stat = (k: string, v: string): HTMLElement =>
      el('div', { class: 'stat' }, [el('div', { class: 'v' }, [v]), el('div', { class: 'k' }, [k])]);
    grid.append(
      stat('斑点长度', fmt(r.patternLengthPct, 1) + ' %'),
      stat('斑点高度', fmt(r.patternHeightPct, 1) + ' %'),
      stat('TE 峰峰值', fmt(te.peakToPeak, 2) + ' μm'),
      stat('啮合频率幅值', fmt(te.meshAmplitude, 2) + ' μm'),
      stat('最大接触应力', r.loaded ? fmt(r.loaded.maxStress, 0) + ' MPa' : '—'),
      stat('计算后端', sim.backend),
    );
    summary.append(grid);

    reportTxt = [
      `齿轮修形与接触斑点仿真报告`,
      `齿轮副: ${pair.name} (${pair.type === 'bevel' ? '锥齿轮/格里森制' : '圆柱齿轮'})`,
      `z1/z2 = ${pair.pinion.teeth}/${pair.gear.teeth}, mn = ${pair.pinion.module} mm, β = ${pair.pinion.helixAngle}°`,
      ``,
      `== 修形方案 ==`,
      `小轮: 鼓形 ${modP?.crowning ?? 0}μm, 齿端修薄 ${modP?.endReliefAmount ?? 0}μm×${modP?.endReliefLength ?? 0}mm, 修缘 ${modP?.tipReliefAmount ?? 0}μm`,
      `大轮: 鼓形 ${modG?.crowning ?? 0}μm, 齿端修薄 ${modG?.endReliefAmount ?? 0}μm×${modG?.endReliefLength ?? 0}mm, 修缘 ${modG?.tipReliefAmount ?? 0}μm`,
      ``,
      `== 装配误差 ==`,
      asm ? `Δa=${asm.centerDistance}μm, fx=${asm.parallelism}μm, fy=${asm.skew}μm, 箱体附加 fx=${asm.housingParallelism}μm fy=${asm.housingSkew}μm` : '无(零误差)',
      ``,
      `== 仿真结果 ==`,
      `斑点: 长度 ${fmt(r.patternLengthPct, 1)}%, 高度 ${fmt(r.patternHeightPct, 1)}%`,
      `传动误差: 峰峰值 ${fmt(te.peakToPeak, 2)} μm, 啮合频率幅值 ${fmt(te.meshAmplitude, 2)} μm`,
      `最大接触应力: ${r.loaded ? fmt(r.loaded.maxStress, 0) : '—'} MPa`,
    ].join('\n');

    csvCurveBtn.disabled = false;
    csvMachineBtn.disabled = false;
    pngBtn.disabled = false;
    txtBtn.disabled = false;
    genBtn.disabled = false;
  };

  csvCurveBtn.onclick = () => download(`${pair.name}-修形曲线.csv`, curveCsv, 'text/csv');
  csvMachineBtn.onclick = () => download(`${pair.name}-磨齿机参数表.csv`, machineCsv, 'text/csv');
  txtBtn.onclick = () => download(`${pair.name}-修形报告.txt`, reportTxt);
  pngBtn.onclick = () => {
    patternCanvas.toBlob((b) => { if (b) download(`${pair.name}-斑点图.png`, b, 'image/png'); });
  };

  root.append(panel, patternPanel);
}
