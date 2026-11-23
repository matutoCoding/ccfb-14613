/**
 * 修形报告页面
 * 导出: 修形曲线(齿向/齿高)、磨齿机修形参数表、仿真斑点图、TE 指标
 * 格式: 可打印 HTML 报告 + CSV 参数表 + PNG 斑点图
 */
import { getState } from '../../db/store';
import { derivePair } from '../../gear/pair';
import { deriveGear } from '../../gear/geometry';
import { modificationAt } from '../../gear/modification';
import { evaluatePattern } from '../../gear/grading';
import { buildGrid, simulateRotation } from '../../gear/tca';
import { effectiveErrors } from '../../gear/assembly';
import { ensurePlan } from './modificationPage';
import { h, toast } from '../dom';
import { HeatmapView } from '../heatmap';
import { LineChart } from '../lineChart';
import { rad2deg } from '../../gear/math3d';
import type { GearPair } from '../../gear/types';

export function reportPage(): HTMLElement {
  const state = getState();
  const pairMaybe = state.pairs.find((p) => p.id === state.currentPairId);
  const root = h('div', { class: 'page page-wide' });
  if (!pairMaybe) return h('div', { class: 'empty' }, '请先创建齿轮副');
  const pair: GearPair = pairMaybe;
  const plan = state.plans.find((p) => p.id === state.currentPlanId && p.pairId === pair.id) ?? ensurePlan(pair.id);
  const asm = state.assemblies.find((a) => a.id === state.currentAssemblyId && a.pairId === pair.id);
  const derived = derivePair(pair);
  const d1 = deriveGear(derived.pinionV);

  const leadChart = new LineChart(560, 280);
  const profileChart = new LineChart(560, 280);
  const patternView = new HeatmapView(460, 340);

  // 修形曲线采样
  const depth = d1.ra - Math.max(d1.rb, d1.rf);
  const faceW = derived.pinionV.faceWidth;
  const m1 = plan.pinion.working;
  const m2 = plan.gear.working;
  const leadPts1: { x: number; y: number }[] = [];
  const leadPts2: { x: number; y: number }[] = [];
  for (let j = 0; j <= 60; j++) {
    const zeta = -1 + (2 * j) / 60;
    const z = (zeta * faceW) / 2;
    leadPts1.push({ x: z, y: modificationAt({ ...m1, topology: null }, zeta, 0.5, faceW, depth) / 1e-3 });
    leadPts2.push({ x: z, y: modificationAt({ ...m2, topology: null }, zeta, 0.5, derived.gearV.faceWidth, depth) / 1e-3 });
  }
  const profPts1: { x: number; y: number }[] = [];
  const profPts2: { x: number; y: number }[] = [];
  for (let i = 0; i <= 60; i++) {
    const rho = i / 60;
    profPts1.push({ x: rho * depth, y: modificationAt({ ...m1, topology: null }, 0, rho, faceW, depth) / 1e-3 });
    profPts2.push({ x: rho * depth, y: modificationAt({ ...m2, topology: null }, 0, rho, derived.gearV.faceWidth, depth) / 1e-3 });
  }
  leadChart.render([
    { label: '小轮齿向', color: '#4ea1ff', points: leadPts1 },
    { label: '大轮齿向', color: '#ff6b5e', points: leadPts2 },
  ], { title: '齿向修形曲线', xLabel: '齿宽 z (mm)', yLabel: '修形量 (μm)' });
  profileChart.render([
    { label: '小轮齿高', color: '#4ea1ff', points: profPts1 },
    { label: '大轮齿高', color: '#ff6b5e', points: profPts2 },
  ], { title: '齿高修形曲线', xLabel: '距齿顶 (mm)', yLabel: '修形量 (μm)' });

  let gradeText = '未仿真';
  let simStats: Record<string, string> = {};
  if (asm) {
    const eff = effectiveErrors(pair, derived, asm);
    const grid = buildGrid(derived, plan, state.currentSide, eff, { nS: 48, nZ: 48 });
    const pat = simulateRotation(grid, plan.redLeadThickness);
    patternView.render(pat.intensity, pat.nS, pat.nZ, grid.s, grid.zeta, {
      title: '仿真接触斑点',
      mode: 'redlead',
      xLabel: '齿宽 ζ',
      yLabel: '齿高 s',
    });
    const grade = evaluatePattern(pat, 8);
    gradeText = `${grade.grade <= 10 ? grade.label : '低于10级'} (${grade.pass ? '合格' : '不合格'})`;
    simStats = {
      斑点长度占比: (pat.lengthFraction * 100).toFixed(1) + '%',
      斑点高度占比: (pat.heightFraction * 100).toFixed(1) + '%',
      质心齿向偏移: pat.centroidZ.toFixed(3) + ' mm',
      接触线倾角: rad2deg(pat.tiltAngle).toFixed(3) + '°',
      评级: gradeText,
      诊断: grade.diagnosis,
    };
  }

  // 磨齿机参数表
  const tableRows: [string, string, string][] = [
    ['齿向鼓形量 Cβ', `${m1.leadCrown} / ${m2.leadCrown}`, 'μm'],
    ['齿端修薄量 Ce', `${m1.endRelief} / ${m2.endRelief}`, 'μm'],
    ['齿端修薄长度 Le', `${m1.endReliefLength} / ${m2.endReliefLength}`, 'mm'],
    ['齿顶修缘量 Ca', `${m1.tipRelief} / ${m2.tipRelief}`, 'μm'],
    ['修缘深度 La', `${m1.tipReliefDepth} / ${m2.tipReliefDepth}`, 'mm'],
    ['螺旋角修正(边缘峰值)', `${m1.helixCorrection} / ${m2.helixCorrection}`, 'μm'],
    ['红丹层厚', `${plan.redLeadThickness}`, 'μm'],
  ];
  const table = h('table', { class: 'data-table' },
    h('thead', {}, h('tr', {}, h('th', {}, '修形项目'), h('th', {}, '小轮 / 大轮'), h('th', {}, '单位'))),
    h('tbody', {}, ...tableRows.map((r) => h('tr', {}, h('td', {}, r[0]), h('td', {}, r[1]), h('td', {}, r[2])))),
  );

  function download(filename: string, content: string | Blob, mime: string): void {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename }) as HTMLAnchorElement;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCsv(): void {
    const lines = [
      '修形项目,小轮,大轮,单位',
      ['齿向鼓形Cβ', m1.leadCrown, m2.leadCrown, 'μm'].join(','),
      ['齿端修薄Ce', m1.endRelief, m2.endRelief, 'μm'].join(','),
      ['修薄长度Le', m1.endReliefLength, m2.endReliefLength, 'mm'].join(','),
      ['齿顶修缘Ca', m1.tipRelief, m2.tipRelief, 'μm'].join(','),
      ['修缘深度La', m1.tipReliefDepth, m2.tipReliefDepth, 'mm'].join(','),
      ['螺旋角修正', m1.helixCorrection, m2.helixCorrection, 'μm'].join(','),
      '',
      '仿真指标,数值',
      ...Object.entries(simStats).map(([k, v]) => `${k},${v}`),
    ];
    download(`${pair.name}-修形参数表.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
    toast('CSV 已导出', 'ok');
  }

  function exportPng(): void {
    patternView.canvas.toBlob((blob) => {
      if (blob) {
        download(`${pair.name}-仿真斑点.png`, blob, 'image/png');
        toast('PNG 已导出', 'ok');
      }
    });
  }

  function exportHtml(): void {
    const doc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>齿轮修形报告 - ${pair.name}</title>
<style>
body{font-family:system-ui,'Microsoft YaHei',sans-serif;max-width:900px;margin:32px auto;color:#222;padding:0 20px}
h1{border-bottom:3px solid #b03030;padding-bottom:8px}
h2{margin-top:28px;color:#b03030}
table{border-collapse:collapse;width:100%;margin:12px 0}
th,td{border:1px solid #888;padding:8px 10px;text-align:left}
th{background:#f0e6e6}
.kv{display:grid;grid-template-columns:200px 1fr;gap:6px 16px;margin:8px 0}
img{max-width:100%;border:1px solid #ccc}
.meta{color:#666;font-size:13px}
</style></head><body>
<h1>齿轮修形与接触斑点仿真报告</h1>
<p class="meta">齿轮副: ${pair.name} | 生成时间: ${new Date().toLocaleString('zh-CN')} | 修形方案: ${plan.name}</p>
<h2>1. 齿轮参数</h2>
<div class="kv">
<span>小轮</span><div>mn=${pair.pinion.module}, z=${pair.pinion.teeth}, β=${rad2deg(pair.pinion.helixAngle).toFixed(2)}°, b=${pair.pinion.faceWidth}mm</div>
<span>大轮</span><div>mn=${pair.gear.module}, z=${pair.gear.teeth}, β=${rad2deg(pair.gear.helixAngle).toFixed(2)}°, b=${pair.gear.faceWidth}mm</div>
<span>名义中心距</span><div>${derived.centerDistance.toFixed(3)} mm</div>
</div>
<h2>2. 磨齿机修形参数表</h2>
<table><thead><tr><th>项目</th><th>小轮 / 大轮</th><th>单位</th></tr></thead><tbody>
${tableRows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}
</tbody></table>
<h2>3. 仿真接触斑点</h2>
<img src="${patternView.canvas.toDataURL('image/png')}" alt="接触斑点">
<h2>4. 接触精度评定</h2>
<div class="kv">${Object.entries(simStats).map(([k, v]) => `<span>${k}</span><div>${v}</div>`).join('')}</div>
<h2>5. 齿向/齿高修形曲线</h2>
<img src="${leadChart.canvas.toDataURL('image/png')}" alt="齿向修形">
<img src="${profileChart.canvas.toDataURL('image/png')}" alt="齿高修形" style="margin-top:12px">
</body></html>`;
    download(`${pair.name}-修形报告.html`, doc, 'text/html;charset=utf-8');
    toast('HTML 报告已导出', 'ok');
  }

  root.append(
    h('div', { class: 'panel' },
      h('div', { class: 'toolbar' },
        h('h2', { style: 'margin:0' }, '修形报告'),
        h('button', { class: 'btn btn-primary', onclick: exportHtml }, '导出 HTML 报告'),
        h('button', { class: 'btn', onclick: exportCsv }, '导出磨齿参数 CSV'),
        h('button', { class: 'btn', onclick: exportPng }, '导出斑点 PNG'),
      ),
      h('p', { class: 'hint' }, `齿轮副 ${pair.name} · 方案 ${plan.name} · ${asm ? '含装配误差仿真' : '尚未运行装配仿真'}`),
    ),
    h('div', { class: 'sim-grid' },
      h('div', { class: 'panel' }, leadChart.canvas),
      h('div', { class: 'panel' }, profileChart.canvas),
      h('div', { class: 'panel' }, table),
      h('div', { class: 'panel' }, patternView.canvas),
    ),
  );
  return root;
}
