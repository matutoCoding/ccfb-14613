import './styles.css';
import { currentRoute, onRouteChange, navigate, type Route } from './ui/router';
import { h, mount } from './ui/dom';
import { refreshAll, getState } from './db/store';
import { seedIfEmpty } from './db/seed';
import { pairPage } from './ui/pages/pairPage';
import { modificationPage } from './ui/pages/modificationPage';
import { assemblyPage } from './ui/pages/assemblyPage';
import { simulationPage } from './ui/pages/simulationPage';
import { comparePage } from './ui/pages/comparePage';
import { reportPage } from './ui/pages/reportPage';

const NAV: { route: Route; label: string }[] = [
  { route: 'pair', label: '齿轮副' },
  { route: 'modification', label: '齿面修形' },
  { route: 'assembly', label: '装配误差' },
  { route: 'simulation', label: '啮合仿真' },
  { route: 'compare', label: '斑点对比' },
  { route: 'report', label: '修形报告' },
];

function shell(): HTMLElement {
  const route = currentRoute();
  const nav = h('nav', { class: 'sidebar' },
    h('div', { class: 'brand' },
      h('div', { class: 'brand-mark' }, '齿'),
      h('div', {}, h('strong', {}, '齿轮修形仿真'), h('div', { class: 'brand-sub' }, 'TCA · WebGPU')),
    ),
    ...NAV.map((n) =>
      h('a', {
        class: 'nav-item' + (n.route === route ? ' active' : ''),
        href: `#/${n.route}`,
      }, n.label),
    ),
    h('div', { class: 'sidebar-foot' },
      h('div', { id: 'pair-indicator', class: 'pair-indicator' }, getState().pairs[0]?.name ?? '未选择齿轮副'),
    ),
  );
  const content = h('main', { class: 'content', id: 'content' });
  return h('div', { class: 'app-shell' }, nav, content);
}

function renderRoute(): void {
  const route = currentRoute();
  const content = document.getElementById('content');
  if (!content) return;
  const pages: Record<Route, () => HTMLElement> = {
    pair: pairPage,
    modification: modificationPage,
    assembly: assemblyPage,
    simulation: simulationPage,
    compare: comparePage,
    report: reportPage,
  };
  try {
    mount(content, pages[route]());
  } catch (e) {
    mount(content, h('div', { class: 'empty error' }, '页面渲染失败: ' + (e as Error).message));
    console.error(e);
  }
  // 导航高亮
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('href') === `#/${route}`);
  });
  const ind = document.getElementById('pair-indicator');
  if (ind) ind.textContent = getState().pairs.find((p) => p.id === getState().currentPairId)?.name ?? '未选择齿轮副';
}

async function bootstrap(): Promise<void> {
  await seedIfEmpty();
  await refreshAll();
  mount(document.getElementById('app')!, shell());
  if (!location.hash) navigate('pair');
  renderRoute();
  onRouteChange(renderRoute);
}

void bootstrap();
