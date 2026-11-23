/**
 * Three.js 三维齿面查看器
 * - 渐开线齿面网格 + 齿根过渡曲面
 * - 法向偏差(修形量)颜色映射, 放大到 μm 级观察
 * - OrbitControls 缩放/旋转, 提供 μm 级"偏差放大"滑块(几何位移 ×增益)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GearParams } from '../gear/types';
import { deriveGear, toothSurface } from '../gear/geometry';
import { modificationAt, type ModificationParams } from '../gear/modification';

export class Gear3DView {
  readonly host: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private gearGroup: THREE.Group | null = null;
  private gain = 200; // 偏差可视化增益(μm 位移放大倍数)
  private resizeObs: ResizeObserver;

  constructor() {
    this.host = document.createElement('div');
    this.host.className = 'gear3d-host';
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(devicePixelRatio);
    this.host.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x141820);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    this.camera.position.set(120, -160, 110);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    const amb = new THREE.AmbientLight(0xffffff, 0.65);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(100, -80, 160);
    this.scene.add(amb, dir, new THREE.DirectionalLight(0x88aaff, 0.35));
    const grid = new THREE.GridHelper(300, 20, 0x33405a, 0x222a3a);
    this.scene.add(grid);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.host);
    this.animate();
  }

  setGain(g: number): void {
    this.gain = g;
  }

  showGear(g: GearParams, mod?: ModificationParams): void {
    if (this.gearGroup) {
      this.scene.remove(this.gearGroup);
      this.gearGroup.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    const group = new THREE.Group();
    const d = deriveGear(g);
    const nR = 30;
    const nZ = 30;
    const depth = d.ra - Math.max(d.rb, d.rf);
    const surf = toothSurface(g, 1, nR, nZ, true);
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const stride = nZ + 1;
    const cmap = new THREE.Color();

    for (let i = 0; i < surf.points.length; i++) {
      const sp = surf.points[i];
      // 修形偏差沿法向放大
      let devUm = 0;
      if (mod) {
        const zetaBar = sp.z / (g.faceWidth / 2);
        const rho = (d.ra - sp.r) / depth;
        devUm = (modificationAt(mod, zetaBar, Math.min(1, Math.max(0, rho)), g.faceWidth, depth) / 1e-3);
      }
      const gainMm = (devUm * 1e-3 * this.gain) / Math.max(1, this.gain);
      const px = sp.p.x + sp.n.x * gainMm;
      const py = sp.p.y + sp.n.y * gainMm;
      const pz = sp.p.z + sp.n.z * gainMm;
      positions.push(px, py, pz);
      const t = Math.min(1, Math.abs(devUm) / 20);
      cmap.setHSL(0.62 - 0.62 * t, 0.85, 0.55);
      colors.push(cmap.r, cmap.g, cmap.b);
    }
    const rows = surf.nR + 1;
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < nZ; j++) {
        const a = i * stride + j;
        const b = a + 1;
        const c = a + stride;
        const dd = c + 1;
        indices.push(a, c, b, b, c, dd);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.55,
      roughness: 0.35,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);

    // 复制到所有轮齿
    const pitch = (2 * Math.PI) / g.teeth;
    const teethGroup = new THREE.Group();
    for (let k = 0; k < g.teeth; k++) {
      const clone = mesh.clone();
      clone.rotation.z = k * pitch;
      teethGroup.add(clone);
    }
    group.add(teethGroup);

    // 齿坯圆柱(简化)
    const blankGeo = new THREE.CylinderGeometry(d.rf * 0.98, d.rf * 0.98, g.faceWidth, 48, 1, true);
    blankGeo.rotateX(Math.PI / 2);
    const blank = new THREE.Mesh(
      blankGeo,
      new THREE.MeshStandardMaterial({ color: 0x4a5568, metalness: 0.7, roughness: 0.4 }),
    );
    group.add(blank);

    this.scene.add(group);
    this.gearGroup = group;
    const target = d.ra * 0.6;
    this.camera.position.set(target * 1.6, -target * 2.1, target * 1.5);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.resize();
  }

  private resize(): void {
    const w = this.host.clientWidth || 600;
    const h = this.host.clientHeight || 420;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.resizeObs.disconnect();
    this.renderer.dispose();
  }
}
