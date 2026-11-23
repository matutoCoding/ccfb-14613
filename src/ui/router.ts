/**
 * 哈希路由: #/pair | #/modification | #/assembly | #/simulation | #/compare | #/report
 */
export type Route = 'pair' | 'modification' | 'assembly' | 'simulation' | 'compare' | 'report';

const ROUTES: Route[] = ['pair', 'modification', 'assembly', 'simulation', 'compare', 'report'];

export function currentRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(hash) ? hash : 'pair';
}

export function navigate(route: Route): void {
  location.hash = `#/${route}`;
}

export function onRouteChange(fn: (r: Route) => void): () => void {
  const handler = (): void => fn(currentRoute());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
