import { renderGearsPage } from './ui/pages/gears';
import { renderModifyPage } from './ui/pages/modify';
import { renderAssemblyPage } from './ui/pages/assembly';
import { renderMeshPage } from './ui/pages/mesh';
import { renderComparePage } from './ui/pages/compare';
import { renderReportPage } from './ui/pages/report';

const routes: Record<string, (root: HTMLElement) => void | Promise<void>> = {
  gears: renderGearsPage,
  modify: renderModifyPage,
  assembly: renderAssemblyPage,
  mesh: renderMeshPage,
  compare: renderComparePage,
  report: renderReportPage,
};

const titles: Record<string, string> = {
  gears: '齿轮副',
  modify: '齿面修形',
  assembly: '装配误差',
  mesh: '啮合仿真',
  compare: '斑点对比',
  report: '修形报告',
};

let cleanup: (() => void) | null = null;

async function route(): Promise<void> {
  const hash = location.hash.replace(/^#\/?/, '') || 'gears';
  const name = routes[hash] ? hash : 'gears';
  document.querySelectorAll('nav a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === `#/${name}`);
  });
  const root = document.getElementById('app')!;
  if (cleanup) { cleanup(); cleanup = null; }
  root.innerHTML = '';
  await routes[name](root);
  document.title = `${titles[name]} - 齿轮修形与接触斑点仿真`;
}

window.addEventListener('hashchange', () => void route());
void route();
