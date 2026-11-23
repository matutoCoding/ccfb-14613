/**
 * 齿轮副页面: 参数表单(圆柱/格里森锥齿轮) + 三维齿面预览
 */
import type { GearPair, GearParams } from '../../gear/types';
import { uid, DEFAULT_LOAD } from '../../gear/types';
import { deg2rad, rad2deg } from '../../gear/math3d';
import { deriveGear } from '../../gear/geometry';
import { derivePair } from '../../gear/pair';
import { pitchAngleFromRatio } from '../../gear/bevel';
import { getState, savePair } from '../../db/store';
import { h, labeledField, numInput, toast } from '../dom';
import { Gear3DView } from '../gear3d';

export function pairPage(): HTMLElement {
  const state = getState();
  const root = h('div', { class: 'page' });
  const pair = state.pairs.find((p) => p.id === state.currentPairId) ?? state.pairs[0];

  if (!pair) {
    root.append(
      h('div', { class: 'empty' },
        h('h3', {}, '还没有齿轮副'),
        h('p', {}, '点击下方按钮创建一个标准斜齿轮副开始'),
        h('button', {
          class: 'btn btn-primary',
          onclick: () => void createDefaultPair(),
        }, '创建示例斜齿轮副'),
      ),
    );
    return root;
  }

  const view = new Gear3DView();
  const left = h('div', { class: 'panel panel-form' });
  const right = h('div', { class: 'panel panel-3d' }, view.host);

  function gearForm(g: GearParams, title: string): HTMLElement {
    const box = h('fieldset', { class: 'gear-form' }, h('legend', {}, title));
    const bind = (label: string, get: () => number, set: (v: number) => void, step: number, unit = ''): HTMLElement =>
      labeledField(label, numInput(get(), step, (v) => { set(v); void persist(); }), unit);

    box.append(
      labeledField('名称', (() => {
        const i = h('input', { value: g.name }) as HTMLInputElement;
        i.addEventListener('change', () => { g.name = i.value; void persist(); });
        return i;
      })()),
      bind('法向模数 mn', () => g.module, (v) => (g.module = v), 0.5, 'mm'),
      bind('齿数 z', () => g.teeth, (v) => (g.teeth = Math.round(v)), 1),
      bind('法向压力角 αn', () => rad2deg(g.pressureAngle), (v) => (g.pressureAngle = deg2rad(v)), 0.5, '°'),
      bind('螺旋角 β', () => rad2deg(g.helixAngle), (v) => (g.helixAngle = deg2rad(v)), 0.5, '°'),
      bind('变位系数 x', () => g.profileShift, (v) => (g.profileShift = v), 0.05),
      bind('齿宽 b', () => g.faceWidth, (v) => (g.faceWidth = v), 1, 'mm'),
      labeledField('旋向', (() => {
        const sel = h('select', {}) as HTMLSelectElement;
        sel.append(new Option('右旋', 'right'), new Option('左旋', 'left'));
        sel.value = g.hand;
        sel.addEventListener('change', () => { g.hand = sel.value as GearParams['hand']; void persist(); });
        return sel;
      })()),
    );

    if (g.kind === 'bevel' && g.bevel) {
      const bv = g.bevel;
      box.append(
        bind('轴交角 Σ', () => rad2deg(bv.shaftAngle), (v) => (bv.shaftAngle = deg2rad(v)), 1, '°'),
        bind('中点螺旋角', () => rad2deg(bv.spiralAngle), (v) => (bv.spiralAngle = deg2rad(v)), 1, '°'),
        bind('外锥距 R', () => bv.outerConeDistance, (v) => (bv.outerConeDistance = v), 1, 'mm'),
        bind('安装距 M', () => bv.mountingDistance, (v) => (bv.mountingDistance = v), 1, 'mm'),
        h('button', {
          class: 'btn',
          onclick: () => {
            const mate = g === pair.pinion ? pair.gear : pair.pinion;
            bv.pitchAngle = pitchAngleFromRatio(g.teeth, mate.teeth, bv.shaftAngle);
            void persist();
          },
        }, '按齿数比自动计算分锥角'),
      );
    }
    return box;
  }

  const info = h('div', { class: 'derived-info' });
  function refreshInfo(): void {
    const d = derivePair(pair);
    const d1 = deriveGear(d.pinionV);
    const d2 = deriveGear(d.gearV);
    info.replaceChildren(
      h('div', { class: 'kv' },
        h('span', {}, '名义中心距'), h('strong', {}, d.centerDistance.toFixed(3) + ' mm'),
        h('span', {}, '小轮分度圆'), h('strong', {}, (d1.r * 2).toFixed(2) + ' mm'),
        h('span', {}, '大轮分度圆'), h('strong', {}, (d2.r * 2).toFixed(2) + ' mm'),
        h('span', {}, '小轮基圆'), h('strong', {}, d1.rb.toFixed(2) + ' mm'),
        h('span', {}, '大轮基圆'), h('strong', {}, d2.rb.toFixed(2) + ' mm'),
        d.isBevel ? h('span', {}, '小轮分锥角') : null,
        d.isBevel ? h('strong', {}, rad2deg(d.bevel1!.pitchAngle).toFixed(3) + '°') : null,
      ),
    );
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  async function persist(): Promise<void> {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await savePair(pair);
      refreshInfo();
      view.showGear(pair.pinion, getState().plans.find((p) => p.id === getState().currentPlanId)?.pinion.working);
    }, 250);
  }

  const toolbar = h('div', { class: 'toolbar' },
    h('select', {
      onchange: (e: Event) => {
        const id = (e.target as HTMLSelectElement).value;
        const target = getState().pairs.find((p) => p.id === id);
        if (target) location.hash = '';
        void Promise.resolve().then(() => {
          getState().currentPairId = id;
          location.reload();
        });
      },
    }, ...state.pairs.map((p) => new Option(p.name, p.id, p.id === pair.id, p.id === pair.id))),
    h('button', { class: 'btn', onclick: () => void createDefaultPair() }, '新建斜齿副'),
    h('button', { class: 'btn', onclick: () => void createBevelPair() }, '新建锥齿副'),
    h('label', { class: 'gain-control' }, '偏差放大',
      (() => {
        const range = h('input', { type: 'range', min: '1', max: '2000', value: '200' }) as HTMLInputElement;
        range.addEventListener('input', () => {
          view.setGain(parseFloat(range.value));
          view.showGear(pair.pinion, getState().plans.find((p) => p.id === getState().currentPlanId)?.pinion.working);
        });
        return range;
      })(),
      '倍'),
  );

  left.append(
    toolbar,
    gearForm(pair.pinion, '小轮 (主动)'),
    gearForm(pair.gear, '大轮 (从动)'),
    labeledField('侧隙 j', numInput(pair.backlash * 1000, 5, (v) => { pair.backlash = v / 1000; void persist(); }), 'μm'),
    info,
  );
  root.append(left, right);
  refreshInfo();
  setTimeout(() => view.showGear(pair.pinion), 50);
  void DEFAULT_LOAD;
  return root;
}

export function makeDefaultHelicalPair(): GearPair {
  return {
    id: uid('pair'),
    name: '斜齿轮副 z21/z43 mn4 β12°',
    updatedAt: Date.now(),
    nominalCenterDistance: 0,
    backlash: 0.12,
    pinion: {
      id: uid('gear'), name: '小轮', kind: 'cylindrical', module: 4, teeth: 21,
      pressureAngle: deg2rad(20), helixAngle: deg2rad(12), hand: 'right', profileShift: 0,
      faceWidth: 60, addendumCoef: 1, clearanceCoef: 0.25,
    },
    gear: {
      id: uid('gear'), name: '大轮', kind: 'cylindrical', module: 4, teeth: 43,
      pressureAngle: deg2rad(20), helixAngle: deg2rad(12), hand: 'left', profileShift: 0,
      faceWidth: 56, addendumCoef: 1, clearanceCoef: 0.25,
    },
  };
}

export function makeDefaultBevelPair(): GearPair {
  const R = 92;
  const mk = (name: string, teeth: number, hand: GearParams['hand']): GearParams => ({
    id: uid('gear'), name, kind: 'bevel', module: 5, teeth,
    pressureAngle: deg2rad(20), helixAngle: deg2rad(35), hand, profileShift: 0,
    faceWidth: 28, addendumCoef: 1, clearanceCoef: 0.25,
    bevel: {
      shaftAngle: deg2rad(90), spiralAngle: deg2rad(35), pitchAngle: 0,
      outerConeDistance: R, mountingDistance: 120, clearanceCoef: 0.25,
    },
  });
  return {
    id: uid('pair'), name: '格里森弧齿锥齿轮副 z17/z29', updatedAt: Date.now(),
    nominalCenterDistance: 0, backlash: 0.15,
    pinion: mk('小锥轮', 17, 'left'), gear: mk('大锥轮', 29, 'right'),
  };
}

async function createDefaultPair(): Promise<void> {
  const pair = makeDefaultHelicalPair();
  await savePair(pair);
  toast('已创建斜齿轮副', 'ok');
  location.hash = '#/pair';
  location.reload();
}

async function createBevelPair(): Promise<void> {
  const pair = makeDefaultBevelPair();
  await savePair(pair);
  toast('已创建锥齿轮副', 'ok');
  location.hash = '#/pair';
  location.reload();
}
