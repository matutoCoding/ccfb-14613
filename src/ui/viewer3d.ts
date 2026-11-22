/**
 * 三维齿面查看器(Three.js):单齿齿面网格,螺旋线扫掠,
 * 修形量按法向位移放大(可到 μm 级视觉放大)+ 顶点着色。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GearParams, ModificationSpec } from '../core/types';
import { gearGeometry, toothProfile2D, rollAtRadius } from '../core/involute';
import { totalModification } from '../core/modification';

export interface ViewerOptions {
  faceSections?: number;
  profilePoints?: number;
  /** 修形放大倍数,0 = 不放大 */
  exaggeration?: number;
}

export class ToothViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private mesh: THREE.Mesh | null = null;
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.scene.background = new THREE.Color(0x1c1f24);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 2, 3);
    const fill = new THREE.DirectionalLight(0xaaccff, 0.8);
    fill.position.set(-2, 1, -2);
    this.scene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.5));
    const onResize = (): void => {
      const w = container.clientWidth || 640, h = container.clientHeight || 420;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(onResize).observe(container);
    onResize();
    const loop = (): void => {
      if (this.disposed) return;
      requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  /** 显示齿面;mod 为 null 显示理论齿面 */
  showTooth(p: GearParams, mod: ModificationSpec | null, opt: ViewerOptions = {}): void {
    const nF = opt.faceSections ?? 40;
    const nP = opt.profilePoints ?? 60;
    const exagg = opt.exaggeration ?? 0;
    const g = gearGeometry(p);
    const profile = toothProfile2D(g, nP, 12);
    // 渐开线段起点索引(前面是过渡曲线)
    const invStart = profile.length - (nP + 1);
    const rollStart = rollAtRadius(g.rb, Math.max(g.rForm, g.rb));
    const rollEnd = rollAtRadius(g.rb, g.ra);

    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const rows = profile.length;

    // 每点 2D 法向(相邻点差分)
    const normals2d: Array<[number, number]> = profile.map((pt, i) => {
      const a = profile[Math.max(0, i - 1)];
      const b = profile[Math.min(rows - 1, i + 1)];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l;
      if (nx * pt[0] + ny * pt[1] < 0) { nx = -nx; ny = -ny; } // 朝外
      return [nx, ny];
    });

    let maxMod = 0;
    const modGrid: number[][] = [];
    for (let i = 0; i <= nF; i++) {
      const t = i / nF;
      const z = (t - 0.5) * g.faceWidth;
      const helixAngle = g.hand * (z * Math.tan(g.beta)) / g.r;
      const row: number[] = [];
      for (let j = 0; j < rows; j++) {
        // 归一化齿廓坐标 s(仅渐开线段有效)
        let s = 0;
        if (j >= invStart) {
          const roll = rollStart + ((rollEnd - rollStart) * (j - invStart)) / (rows - 1 - invStart);
          s = (roll - rollStart) / Math.max(1e-9, rollEnd - rollStart);
        }
        const m = totalModification(mod, t, s, g.faceWidth); // μm
        row.push(m);
        if (Math.abs(m) > maxMod) maxMod = Math.abs(m);
        const disp = (m / 1000) * exagg; // mm
        const [px, py] = profile[j];
        const [nx, ny] = normals2d[j];
        const x0 = px - nx * disp, y0 = py - ny * disp;
        const c = Math.cos(helixAngle), sn = Math.sin(helixAngle);
        positions.push(x0 * c - y0 * sn, x0 * sn + y0 * c, z);
      }
      modGrid.push(row);
    }
    // 颜色:修形量蓝(0)→红(max)
    for (let i = 0; i <= nF; i++) {
      for (let j = 0; j < rows; j++) {
        const v = maxMod > 1e-9 ? modGrid[i][j] / maxMod : 0;
        const col = new THREE.Color().setHSL(0.62 - 0.62 * Math.max(0, Math.min(1, v)), 0.85, 0.55);
        colors.push(col.r, col.g, col.b);
      }
    }
    for (let i = 0; i < nF; i++) {
      for (let j = 0; j < rows - 1; j++) {
        const a = i * rows + j, b = a + rows;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, metalness: 0.35, roughness: 0.45 });
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.mesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.mesh);
    // 相机对准
    const r = g.ra;
    this.camera.position.set(r * 1.6, r * 1.2, g.faceWidth * 1.8);
    this.camera.near = r / 100;
    this.camera.far = r * 50;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
