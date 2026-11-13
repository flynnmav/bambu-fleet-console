import * as THREE from 'three';
import type { PrinterStatus } from '../types';

export type PrinterModelKind = 'h2s' | 'x1-carbon' | 'p1s' | 'a1' | 'a1-mini' | 'generic';

export function identifyPrinterModel(name: string): { kind: PrinterModelKind; label: string } {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key.includes('h2s')) return { kind: 'h2s', label: 'H2S' };
  if (key.includes('x1carbon') || key.endsWith('x1c') || key === 'x1') return { kind: 'x1-carbon', label: 'X1 Carbon' };
  if (key.includes('p1s')) return { kind: 'p1s', label: 'P1S' };
  if (key.includes('a1mini')) return { kind: 'a1-mini', label: 'A1 mini' };
  if (key === 'a1' || key === 'bambua1' || key.includes('bambulaba1') || key.startsWith('a1combo')) return { kind: 'a1', label: 'A1' };
  return { kind: 'generic', label: '通用打印机 · 示意外形' };
}

export interface PrinterModel {
  group: THREE.Group;
  kind: PrinterModelKind;
  label: string;
  update: (status: PrinterStatus, progress: number | undefined, lightOn: boolean, seconds: number, animate: boolean) => void;
  dispose: () => void;
}

/** Dispose each shared GPU resource once, including label textures. */
export function disposeModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  root.clear();
}

export function createPrinterModel(name: string): PrinterModel {
  const { kind, label } = identifyPrinterModel(name);
  const group = new THREE.Group();
  group.name = label;
  const material = (color: THREE.ColorRepresentation, metalness = 0, roughness = 0.4) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness });
  const charcoal = material('#252b30', 0.5, 0.34);
  const black = material('#101619', 0.25, 0.45);
  const rubber = material('#171c1e', 0, 0.85);
  const silver = material('#bdc6ca', 0.78, 0.28);
  const white = material('#e1e4df', 0.3, 0.32);
  const steel = material('#909ea7', 0.85, 0.22);
  const brass = material('#c99143', 0.75, 0.25);
  const bedMaterial = material('#555953', 0.48, 0.68);
  const partMaterial = material('#69ba4c', 0.05, 0.34);
  const ledMaterial = new THREE.MeshStandardMaterial({ color: '#dcf9e5', emissive: '#c1ffd9', emissiveIntensity: 1.4, roughness: 0.3 });
  const statusMaterial = new THREE.MeshStandardMaterial({ color: '#5fc994', emissive: '#5fc994', emissiveIntensity: 0.65 });
  // Low-opacity physical glazing leaves the mechanics readable at card sizes.
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#98bcc2', metalness: 0.05, roughness: 0.1, transmission: 0.18,
    thickness: 0.025, transparent: true, opacity: 0.19, depthWrite: false,
    side: THREE.DoubleSide, clearcoat: 1, envMapIntensity: 0.65,
  });
  const mesh = (geometry: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = group) => {
    const object = new THREE.Mesh(geometry, mat);
    object.castShadow = mat !== glass;
    object.receiveShadow = mat !== glass;
    parent.add(object);
    return object;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, parent: THREE.Object3D = group) => {
    const object = mesh(new THREE.BoxGeometry(w, h, d), mat, parent);
    object.position.set(x, y, z);
    return object;
  };
  const cylinder = (radius: number, length: number, x: number, y: number, z: number, mat: THREE.Material, axis: 'x' | 'y' | 'z' = 'y', parent: THREE.Object3D = group) => {
    const object = mesh(new THREE.CylinderGeometry(radius, radius, length, 20), mat, parent);
    if (axis === 'x') object.rotation.z = Math.PI / 2;
    if (axis === 'z') object.rotation.x = Math.PI / 2;
    object.position.set(x, y, z);
    return object;
  };
  const tube = (points: THREE.Vector3[], radius: number, mat: THREE.Material, parent: THREE.Object3D = group) =>
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, radius, 8, false), mat, parent);
  const text = (value: string, w: number, h: number, x: number, y: number, z: number, color = '#d4dbdc', background = '#182125', parent: THREE.Object3D = group) => {
    const compact = w < 0.5;
    const canvasW = compact ? 256 : 512;
    const canvasH = compact ? 64 : 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = background;
    context.fillRect(0, 0, canvasW, canvasH);
    context.font = `600 ${compact ? 22 : 42}px Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = color;
    context.fillText(value, canvasW / 2, canvasH / 2 + 2, canvasW - (compact ? 22 : 42));
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.generateMipmaps = false;
    map.minFilter = THREE.LinearFilter;
    const object = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, toneMapped: false }), parent);
    object.position.set(x, y, z);
    object.castShadow = false;
  };
  const screw = (x: number, y: number, z: number) => {
    cylinder(0.023, 0.012, x, y, z, steel, 'z');
    box(0.025, 0.004, 0.006, x, y, z + 0.01, black);
  };
  const feet = (width: number, depth: number) => {
    for (const x of [-width / 2, width / 2]) for (const z of [-depth / 2, depth / 2]) {
      cylinder(0.105, 0.1, x, 0.055, z, rubber);
    }
  };
  const bed = new THREE.Group();
  group.add(bed);
  let bedY = 0.65;
  let bedWidth = 1.78;
  let bedDepth = 1.62;
  const h2s = kind === 'h2s';
  const enclosed = h2s || kind === 'x1-carbon' || kind === 'p1s';
  const mini = kind === 'a1-mini';
  const toolhead = new THREE.Group();
  const gantry = new THREE.Group();
  group.add(toolhead, gantry);
  let headY = 2.18;
  let headZ = 0;

  if (h2s) {
    // Approximate H2S, not CAD: 492 × 514 × 626 mm overall, 340 × 320 × 340 mm build space.
    // Exterior / colours: https://us.store.bambulab.com/products/h2s
    // Single nozzle: https://blog.bambulab.com/h2s-the-ultimate-single-nozzle-3d-printer-now-bigger-than-ever/
    // Dimensions / 5-inch touchscreen: https://bambulab.cn/zh-cn/h2s/tech-specs
    // Hinged screen above the glass door: https://wiki.bambulab.com/en/h2s/maintenance/replace-front-cover
    const shell = material('#b0b2af', 0.18, 0.48);
    feet(2.36, 2.46);
    box(2.7, 0.26, 2.82, 0, 0.24, 0, shell);
    box(2.5, 0.1, 2.6, 0, 0.42, 0, black);
    // Tall grey side skins, dark upper frame and a recessed rear chamber panel.
    for (const x of [-1.28, 1.28]) {
      box(0.14, 2.77, 2.72, x, 1.79, 0, shell);
      box(0.18, 0.27, 2.82, x, 3.25, 0, charcoal);
      box(0.022, 2.53, 0.024, x * 1.06, 1.79, 0.95, black);
      for (let i = 0; i < 9; i++) box(0.025, 0.024, 0.5, x * 1.06, 0.62 + i * 0.052, -0.78, black);
    }
    box(2.43, 2.72, 0.1, 0, 1.8, -1.34, charcoal);
    for (const x of [-1.18, 1.18]) box(0.12, 2.71, 0.13, x, 1.78, 1.3, charcoal);
    box(2.7, 0.33, 0.18, 0, 3.22, 1.32, charcoal);
    box(2.7, 0.27, 0.18, 0, 3.25, -1.32, charcoal);
    // Separate top glazing and rear vent panel; no assumed AMS count or placement.
    box(2.35, 0.045, 2.18, 0, 3.42, 0.12, glass);
    for (const x of [-1.2, 1.2]) box(0.055, 0.055, 2.36, x, 3.43, 0.08, black);
    for (const z of [-1.09, 1.25]) box(2.43, 0.055, 0.055, 0, 3.43, z, black);
    box(2.35, 0.055, 0.26, 0, 3.42, -1.22, charcoal);
    for (let i = 0; i < 16; i++) box(0.065, 0.01, 0.18, -1.06 + i * 0.14, 3.454, -1.22, black);
    // Broad front door, light outer pillars, dark border and vertical right-hand grip.
    box(2.27, 2.55, 0.028, 0, 1.75, 1.395, glass);
    for (const x of [-1.145, 1.145]) box(0.045, 2.59, 0.045, x, 1.75, 1.42, black);
    for (const y of [0.46, 3.04]) box(2.33, 0.045, 0.045, 0, y, 1.42, black);
    for (const y of [0.83, 2.65]) box(0.075, 0.22, 0.09, -1.15, y, 1.44, charcoal);
    box(0.065, 0.55, 0.1, 1.04, 1.82, 1.49, charcoal);
    for (const y of [1.58, 2.06]) box(0.1, 0.045, 0.12, 1.04, y, 1.45, black);
    // H2S has its own landscape touch display at the upper right, unlike X1's left display.
    const screen = new THREE.Group();
    screen.name = 'H2S hinged touchscreen';
    screen.position.set(0.79, 3.2, 1.47);
    screen.rotation.x = -0.08;
    group.add(screen);
    box(0.38, 0.08, 0.13, 0, -0.18, -0.08, steel, screen);
    box(0.79, 0.47, 0.1, 0, 0, 0, black, screen);
    box(0.69, 0.37, 0.012, 0, 0, 0.058, charcoal, screen);
    text('H2S', 0.59, 0.12, 0, 0.1, 0.067, '#dbe6e3', '#252b30', screen);
    text('340 × 320 × 340', 0.6, 0.1, 0, -0.035, 0.067, '#9edbb7', '#252b30', screen);
    box(0.49, 0.018, 0.012, 0, -0.135, 0.068, statusMaterial, screen);
    text('H2S', 0.36, 0.2, -0.95, 3.22, 1.418, '#e4e6e2', '#252b30');
    text('B A M B U  L A B', 0.91, 0.11, 0, 0.25, 1.419, '#555e5c', '#b0b2af');
    box(2.39, 0.035, 0.035, 0, 0.4, 1.42, silver);
    // Single-head CoreXY mechanics, a rear air duct, and chamber illumination.
    for (const x of [-1.02, 1.02]) {
      cylinder(0.03, 2.4, x, 1.71, -0.96, steel);
      for (let i = 0; i < 30; i++) cylinder(0.038, 0.009, x, 0.55 + i * 0.078, -0.96, charcoal);
      box(0.11, 0.12, 2.19, x, 2.77, 0, charcoal);
      box(0.025, 0.025, 2.16, x - 0.07, 2.85, 0, rubber);
    }
    for (const z of [-0.13, 0.13]) cylinder(0.035, 2.13, 0, 2.77, z, steel, 'x', gantry);
    for (const z of [-0.23, 0.23]) box(2.13, 0.025, 0.025, 0, 2.85, z, rubber, gantry);
    box(0.25, 1.2, 0.14, 0.93, 1.6, -1.2, black);
    for (let i = 0; i < 13; i++) box(0.21, 0.025, 0.025, 0.93, 1.08 + i * 0.085, -1.115, charcoal);
    box(0.045, 0.04, 2.04, -1.14, 2.96, 0, ledMaterial);
    box(0.16, 0.12, 0.1, -0.96, 2.95, -1.15, black);
    cylinder(0.034, 0.018, -0.96, 2.95, -1.087, steel, 'z');
    tube([new THREE.Vector3(0.04, 2.9, -0.04), new THREE.Vector3(-0.18, 3.17, -0.3), new THREE.Vector3(-0.75, 3.12, -1.1)], 0.025, white);
    bedWidth = 2.05;
    bedDepth = 1.93;
    bedY = 1.1;
    headY = 2.63;
  } else if (enclosed) {
    const shell = kind === 'x1-carbon' ? silver : charcoal;
    feet(1.94, 1.75);
    box(2.4, 0.24, 2.18, 0, 0.22, 0, shell);
    box(2.27, 0.09, 2.03, 0, 0.39, 0, black);
    // Real perimeter rails and separate panels, never a filled enclosure cube.
    for (const x of [-1.11, 1.11]) for (const z of [-0.99, 0.99]) {
      box(0.14, 2.36, 0.14, x, 1.58, z, shell);
    }
    for (const z of [-1, 1]) box(2.4, 0.2, 0.18, 0, 2.8, z, shell);
    for (const x of [-1.11, 1.11]) box(0.18, 0.2, 1.84, x, 2.8, 0, shell);
    box(2.11, 2.29, 0.085, 0, 1.55, -1.02, charcoal);
    box(0.065, 2.22, 1.95, -1.16, 1.54, 0, shell);
    box(0.065, 2.22, 1.95, 1.16, 1.54, 0, shell);
    // Recessed seams and vents break up the aluminium/black side panels.
    for (let i = 0; i < 10; i++) {
      box(0.074, 0.022, 0.42, 1.198, 0.59 + i * 0.048, -0.53, black);
    }
    box(2.08, 0.055, 1.83, 0, 2.91, 0, glass);
    for (const z of [-0.91, 0.91]) box(2.13, 0.033, 0.033, 0, 2.93, z, black);
    for (const x of [-1.05, 1.05]) box(0.033, 0.033, 1.83, x, 2.93, 0, black);
    // Front glass door with slim border, hinges, handle and a visible sill.
    box(2.06, 2.15, 0.025, 0, 1.59, 1.065, glass);
    for (const x of [-1.035, 1.035]) box(0.04, 2.17, 0.045, x, 1.59, 1.075, black);
    for (const y of [0.51, 2.67]) box(2.1, 0.045, 0.045, 0, y, 1.075, black);
    for (const y of [0.84, 2.29]) box(0.07, 0.19, 0.09, -1.04, y, 1.1, charcoal);
    box(0.065, 0.43, 0.075, 0.91, 1.56, 1.15, black);
    for (const y of [1.38, 1.74]) box(0.11, 0.045, 0.11, 0.91, y, 1.11, charcoal);
    // Z lead screws, smooth rods, XY carbon rails and toothed belts.
    for (const x of [-0.87, 0.87]) {
      cylinder(0.026, 1.99, x, 1.47, -0.72, steel);
      for (let i = 0; i < 26; i++) cylinder(0.035, 0.008, x, 0.52 + i * 0.07, -0.72, charcoal);
      cylinder(0.024, 1.85, x, 1.48, 0.7, steel);
      box(0.085, 0.11, 1.76, x, 2.31, 0, black);
      box(0.024, 0.025, 1.77, x - 0.06, 2.4, 0, rubber);
    }
    for (const z of [-0.11, 0.12]) cylinder(0.032, 1.87, 0, 2.31, z, charcoal, 'x', gantry);
    for (const z of [-0.21, 0.22]) {
      box(1.87, 0.021, 0.024, 0, 2.4, z, rubber, gantry);
      for (let i = 0; i < 26; i++) box(0.012, 0.015, 0.031, -0.88 + i * 0.07, 2.385, z, charcoal, gantry);
    }
    box(0.045, 0.035, 1.55, -1.025, 2.53, 0, ledMaterial);
    // Interior rear fan, with hub, grille and blades visible through the door.
    cylinder(0.27, 0.055, 0.62, 1.61, -0.94, black, 'z');
    const fanRing = mesh(new THREE.TorusGeometry(0.23, 0.014, 8, 32), steel);
    fanRing.position.set(0.62, 1.61, -0.9);
    for (let i = 0; i < 5; i++) {
      const blade = box(0.3, 0.055, 0.025, 0.62, 1.61, -0.89, charcoal);
      blade.rotation.z = i * Math.PI / 5;
    }
    cylinder(0.065, 0.04, 0.62, 1.61, -0.87, steel, 'z');
    bedY = 0.96;
    if (kind === 'x1-carbon') {
      const screen = box(0.65, 0.52, 0.115, -0.67, 2.66, 1.18, black);
      screen.rotation.x = -0.12;
      text('X1 CARBON', 0.55, 0.14, -0.67, 2.76, 1.247, '#c3d7d4', '#101b20');
      text('MODEL  /  256', 0.53, 0.13, -0.67, 2.59, 1.25, '#7ae2ae', '#101b20');
      box(0.45, 0.02, 0.01, -0.67, 2.49, 1.25, statusMaterial);
    } else {
      box(0.56, 0.31, 0.105, 0.76, 2.71, 1.15, black);
      text('P1S', 0.3, 0.16, 0.69, 2.73, 1.209, '#abd8bb', '#152522');
      cylinder(0.057, 0.03, 0.94, 2.7, 1.22, charcoal, 'z');
      box(0.26, 0.018, 0.01, 0.68, 2.62, 1.215, statusMaterial);
    }
    text('B A M B U  L A B', 0.88, 0.12, 0, 0.24, 1.1, '#adb8ba', kind === 'x1-carbon' ? '#a3aeb2' : '#252b30');
    for (const x of [-1.1, 1.1]) for (const y of [0.25, 2.8]) screw(x, y, 1.1);
    tube([new THREE.Vector3(0.04, 2.38, -0.04), new THREE.Vector3(-0.12, 2.65, -0.2), new THREE.Vector3(-0.73, 2.65, -0.55)], 0.027, black);
  } else {
    const generic = kind === 'generic';
    bedWidth = mini ? 1.39 : 1.78;
    bedDepth = mini ? 1.34 : 1.65;
    bedY = 0.48;
    headY = mini ? 1.75 : 1.98;
    headZ = -0.03;
    feet(mini ? 1.65 : 2.05, 1.52);
    box(mini ? 2.05 : 2.47, 0.25, 1.98, 0, 0.24, 0, white);
    box(mini ? 1.95 : 2.36, 0.05, 1.86, 0, 0.39, 0, charcoal);
    for (const x of [-0.36, 0.36]) {
      cylinder(0.033, 1.71, x, 0.43, 0, steel, 'z');
      box(0.16, 0.09, 0.38, x, 0.48, 0.12, black);
    }
    box(0.034, 0.028, 1.8, 0, 0.44, 0, rubber);
    if (mini) {
      // A1 mini: one tall column and a true cantilever arm, with no right pillar.
      box(0.25, 2.13, 0.31, -0.86, 1.46, -0.49, white);
      box(0.09, 1.99, 0.045, -0.86, 1.46, -0.302, steel);
      cylinder(0.027, 1.94, -0.95, 1.44, -0.3, steel);
      box(1.94, 0.17, 0.23, -0.02, 1.93, -0.17, white, gantry);
      cylinder(0.026, 1.76, 0.02, 1.91, -0.028, steel, 'x', gantry);
      box(1.75, 0.025, 0.026, 0.02, 2.025, -0.035, rubber, gantry);
      box(0.25, 0.4, 0.36, -0.86, 1.94, -0.36, charcoal, gantry);
      box(0.32, 0.055, 0.4, -0.86, 2.54, -0.49, charcoal);
    } else {
      // A1 and the explicitly generic fallback use a dual-column open gantry.
      for (const x of [-1.02, 1.02]) {
        box(0.18, 2.29, 0.22, x, 1.51, -0.45, generic ? charcoal : white);
        box(0.063, 2.08, 0.04, x, 1.52, -0.31, steel);
        cylinder(0.027, 2.04, x + 0.06, 1.52, -0.29, steel);
        box(0.27, 0.18, 0.28, x, 2.18, -0.36, charcoal, gantry);
      }
      box(2.23, 0.16, 0.27, 0, 2.7, -0.45, generic ? charcoal : white);
      box(2.15, 0.14, 0.21, 0, 2.17, -0.19, white, gantry);
      cylinder(0.028, 1.99, 0, 2.15, -0.04, steel, 'x', gantry);
      box(1.97, 0.025, 0.025, 0, 2.26, -0.04, rubber, gantry);
      for (let i = 0; i < 28; i++) box(0.012, 0.012, 0.032, -0.94 + i * 0.07, 2.245, -0.04, charcoal, gantry);
    }
    // External single spool, not an AMS. Its annular flanges have open centres.
    const spool = new THREE.Group();
    group.add(spool);
    spool.position.set(mini ? -1.03 : 0.62, mini ? 0.98 : 2.83, -0.84);
    cylinder(0.04, 0.46, 0, 0, 0, steel, 'z', spool);
    const spoolMaterial = material('#b8c1b6', 0, 0.55);
    for (const z of [-0.16, 0.16]) {
      const flange = mesh(new THREE.TorusGeometry(0.29, 0.028, 8, 40), white, spool);
      flange.position.z = z;
      for (let i = 0; i < 6; i++) {
        const spoke = box(0.5, 0.025, 0.025, 0, 0, z, white, spool);
        spoke.rotation.z = i * Math.PI / 3;
      }
    }
    const filament = mesh(new THREE.TorusGeometry(0.18, 0.095, 12, 40), spoolMaterial, spool);
    filament.scale.z = 1.5;
    tube([new THREE.Vector3(mini ? -1 : 0.6, mini ? 1.2 : 2.95, -0.83), new THREE.Vector3(-0.5, 3.01, -0.54), new THREE.Vector3(0, headY + 0.43, headZ)], 0.018, white);
    // Front-right display on a separate angled mount.
    box(0.49, 0.33, 0.09, mini ? 0.75 : 0.95, 0.44, 0.95, black).rotation.x = -0.32;
    text(mini ? 'A1 mini' : generic ? 'GENERIC' : 'A1', 0.4, 0.14, mini ? 0.75 : 0.95, 0.47, 1.012, '#a5e7bf', '#172324');
    box(0.25, 0.016, 0.01, mini ? 0.75 : 0.95, 0.36, 1.014, statusMaterial);
    text(generic ? 'MODEL STUDY' : 'B A M B U  L A B', 0.78, 0.1, -0.35, 0.23, 1.001, '#67716b', '#e1e4df');
  }

  bed.position.y = bedY;
  box(bedWidth, 0.11, bedDepth, 0, -0.055, 0, black, bed);
  box(bedWidth + 0.04, 0.025, bedDepth + 0.04, 0, 0.016, 0, bedMaterial, bed);
  // Fine surface lines and edge tabs make the removable plate legible.
  for (let i = 0; i < 14; i++) box(bedWidth - 0.08, 0.002, 0.003, 0, 0.03, -bedDepth / 2 + 0.06 + i * bedDepth / 15, steel, bed);
  box(0.35, 0.028, 0.12, 0, 0.012, bedDepth / 2 + 0.04, bedMaterial, bed);
  for (const x of [-bedWidth / 2 + 0.08, bedWidth / 2 - 0.08]) box(0.08, 0.033, 0.12, x, 0.035, bedDepth / 2 - 0.1, black, bed);

  const part = new THREE.Group();
  part.position.set(-0.08, 0.032, 0.06);
  bed.add(part);
  // Twisted, hollow ribbed vessel: visible interior and actual layer-like geometry.
  const outline: THREE.Vector2[] = [];
  const vesselHeight = mini ? 0.7 : 0.88;
  for (let i = 0; i <= 34; i++) {
    const t = i / 34;
    outline.push(new THREE.Vector2(0.27 + Math.sin(t * Math.PI * 1.4) * 0.075 + Math.sin(t * Math.PI * 26) * 0.006, 0.015 + t * vesselHeight));
  }
  for (let i = 34; i >= 0; i--) {
    const t = i / 34;
    outline.push(new THREE.Vector2(0.235 + Math.sin(t * Math.PI * 1.4) * 0.075, Math.max(0.04, 0.015 + t * vesselHeight)));
  }
  mesh(new THREE.LatheGeometry(outline, 64), partMaterial, part);
  cylinder(0.285, 0.018, 0, 0.009, 0, partMaterial, 'y', part);
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    const rib = tube(Array.from({ length: 9 }, (_, j) => {
      const t = j / 8;
      const radius = 0.272 + Math.sin(t * Math.PI * 1.4) * 0.075;
      return new THREE.Vector3(Math.cos(angle + t * 0.8) * radius, t * vesselHeight + 0.02, Math.sin(angle + t * 0.8) * radius);
    }), 0.013, partMaterial, part);
    rib.castShadow = true;
  }
  const orangeMaterial = material('#de8f43', 0, 0.43);
  box(0.31, 0.035, 0.32, 0.48, 0.02, -0.3, orangeMaterial, bed);
  for (let i = 0; i < 5; i++) box(0.26 - i * 0.033, 0.055, 0.26 - i * 0.033, 0.48, 0.064 + i * 0.055, -0.3, orangeMaterial, bed);

  toolhead.position.set(0.15, headY, headZ);
  if (h2s) {
    // H2S single-nozzle servo head: wider cooling shoulders and one central hotend.
    toolhead.name = 'H2S single-nozzle toolhead';
    box(0.54, 0.42, 0.37, 0, 0.06, 0, white, toolhead);
    box(0.38, 0.28, 0.045, 0, 0.035, 0.208, charcoal, toolhead);
    for (const x of [-0.23, 0.23]) {
      box(0.12, 0.22, 0.21, x, -0.07, 0.09, charcoal, toolhead);
      box(0.1, 0.055, 0.12, x * 0.67, -0.17, 0.1, black, toolhead);
    }
    for (let i = 0; i < 5; i++) box(0.27, 0.012, 0.014, 0, 0.135 - i * 0.045, 0.238, black, toolhead);
    cylinder(0.039, 0.018, 0.16, -0.07, 0.252, steel, 'z', toolhead);
  } else {
    box(0.47, 0.38, 0.33, 0, 0.04, 0, enclosed ? charcoal : white, toolhead);
    box(0.4, 0.2, 0.035, 0, 0.0, 0.19, black, toolhead);
    cylinder(0.083, 0.026, 0, 0.015, 0.22, charcoal, 'z', toolhead);
    cylinder(0.028, 0.03, 0, 0.015, 0.24, steel, 'z', toolhead);
    for (let i = 0; i < 6; i++) box(0.26, 0.008, 0.02, 0, 0.2 - i * 0.026, 0.177, black, toolhead);
  }
  box(0.16, 0.055, 0.14, 0, -0.18, 0, black, toolhead);
  const nozzle = mesh(new THREE.ConeGeometry(0.045, 0.085, 16), brass, toolhead);
  nozzle.rotation.z = Math.PI;
  nozzle.position.y = -0.245;
  box(0.13, 0.025, 0.02, 0.12, 0.18, 0.185, statusMaterial, toolhead);

  const chamber = new THREE.PointLight('#d6ffe7', 4, 4, 2);
  chamber.position.set(-0.6, h2s ? 2.96 : enclosed ? 2.48 : 2.6, 0.35);
  group.add(chamber);
  const home = new THREE.Vector3(0.15, headY, headZ);
  let previousColor = '';
  return {
    group, kind, label,
    update(status, progress, lightOn, seconds, animate) {
      const color = status === 'error' ? '#e97461' : status === 'paused' ? '#e6ae5b' : status === 'offline' ? '#718087' : '#67cf9b';
      if (color !== previousColor) {
        statusMaterial.color.set(color);
        statusMaterial.emissive.set(color);
        partMaterial.color.set(status === 'paused' || status === 'error' ? '#df9650' : '#70bd4c');
        previousColor = color;
      }
      const hasProgress = typeof progress === 'number' && Number.isFinite(progress);
      const fraction = hasProgress ? THREE.MathUtils.clamp(progress / 100, 0, 1) : 0.62;
      const height = status === 'printing' || status === 'paused' ? Math.max(0.09, fraction) : 0.83;
      part.scale.y = height;
      chamber.intensity = lightOn ? (enclosed ? 4 : 1.8) : 0;
      ledMaterial.emissiveIntensity = lightOn ? 1.6 : 0.08;
      statusMaterial.emissiveIntensity = status === 'offline' ? 0 : 0.55;
      toolhead.position.copy(home);
      bed.position.set(0, bedY, 0);
      gantry.position.set(0, 0, 0);
      if (status === 'printing' || status === 'paused') {
        if (enclosed) bed.position.y = headY - 0.3 - 0.032 - vesselHeight * height;
        else toolhead.position.y = bedY + 0.032 + vesselHeight * height + 0.3;
        // Illustrative movement only; this is deliberately not telemetry positioning.
        if (animate && status === 'printing') {
          toolhead.position.x = -0.08 + Math.cos(seconds * 0.7) * 0.29;
          if (enclosed) toolhead.position.z = 0.06 + Math.sin(seconds * 0.7) * 0.22;
          else bed.position.z = -Math.sin(seconds * 0.7) * 0.18;
        }
      }
      if (enclosed) gantry.position.z = toolhead.position.z;
      else gantry.position.y = toolhead.position.y - home.y;
    },
    dispose: () => disposeModel(group),
  };
}
