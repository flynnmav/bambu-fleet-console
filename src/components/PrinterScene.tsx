import { useEffect, useId, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { PrinterStatus } from '../types';
import { createPrinterModel, disposeModel, identifyPrinterModel } from '../lib/printer-models';
import type { PrinterModel } from '../lib/printer-models';

export interface PrinterSceneProps {
  model: string;
  status: PrinterStatus;
  progress?: number;
  lightOn: boolean;
}

interface SceneHandle {
  reset: () => void;
  invalidate: () => void;
  setModel: (name: string) => void;
}

const STATUS_TEXT: Record<PrinterStatus, string> = {
  printing: '正在打印', idle: '设备空闲', paused: '打印暂停', offline: '设备离线', error: '设备异常',
};

/** One renderer per mounted component. Telemetry is read through refs, never an effect dependency. */
export default function PrinterScene({ model, status, progress, lightOn }: PrinterSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const stateRef = useRef({ model, status, progress, lightOn, autoRotate: false });
  const [autoRotate, setAutoRotate] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [restoreCount, setRestoreCount] = useState(0);
  const captionId = useId();
  const info = identifyPrinterModel(model);
  stateRef.current = { model, status, progress, lightOn, autoRotate };

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let printer: PrinterModel | null = null;
    let environment: THREE.WebGLRenderTarget | null = null;
    let pmrem: THREE.PMREMGenerator | null = null;
    let room: RoomEnvironment | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;
    let frameId = 0;
    let disposed = false;
    let contextLost = false;
    let visible = typeof IntersectionObserver === 'undefined';
    let width = 0;
    let height = 0;
    let interacting = false;
    let settlingUntil = 0;
    let lastFrame = 0;
    let activeSeconds = 0;
    let lastAnimationFrame = 0;
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduceMotion = motionQuery.matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(33, 1.25, 0.1, 70);
    const homeDirection = new THREE.Vector3(4.6, 2.8, 6.2).normalize();
    let homeDistance = 7;
    let currentKind = '';
    const stop = () => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      lastFrame = 0;
      lastAnimationFrame = 0;
    };
    const canRender = () => !disposed && !contextLost && visible && !document.hidden && width > 0 && height > 0;
    const requestRender = () => {
      if (canRender() && !frameId) frameId = requestAnimationFrame(draw);
    };
    const resetCamera = () => {
      if (!controls || !printer) return;
      const bounds = new THREE.Box3().setFromObject(printer.group);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      // Fit projected corners rather than a loose bounding sphere: fills a 400 × 320 card.
      controls.target.set(center.x, center.y, center.z);
      camera.position.copy(center).add(homeDirection);
      camera.lookAt(center);
      camera.updateMatrixWorld(true);
      const inverseRotation = new THREE.Matrix4().extractRotation(camera.matrixWorld).invert();
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const tanH = tanV * Math.max(0.2, camera.aspect);
      let fit = 0;
      for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
        const corner = new THREE.Vector3(size.x * x, size.y * y, size.z * z).applyMatrix4(inverseRotation);
        fit = Math.max(fit, corner.z + Math.abs(corner.y) / tanV, corner.z + Math.abs(corner.x) / tanH);
      }
      homeDistance = fit * 1.13;
      controls.minDistance = homeDistance * 0.78;
      controls.maxDistance = homeDistance * 1.48;
      // Remove residual orbit damping when the reset button is pressed.
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(homeDirection, homeDistance);
      camera.lookAt(center);
      controls.update();
      controls.enableDamping = damping;
      settlingUntil = performance.now() + 250;
      requestRender();
    };
    const resize = () => {
      if (!renderer || disposed) return;
      const rect = host.getBoundingClientRect();
      const nextWidth = Math.round(rect.width);
      const nextHeight = Math.round(rect.height);
      if (width === nextWidth && height === nextHeight) return;
      width = nextWidth;
      height = nextHeight;
      if (!width || !height) { stop(); return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      resetCamera();
      requestRender();
    };
    const fail = (message: string) => {
      contextLost = true;
      stop();
      setFailure(message);
    };
    function draw(now: number) {
      frameId = 0;
      if (!canRender() || !renderer || !controls || !printer) return;
      const state = stateRef.current;
      const animate = !reduceMotion;
      const continuous = animate && (state.autoRotate || state.status === 'printing');
      // Cap continuous illustration at 30 fps; idle scenes render only on changes.
      if (continuous && !interacting && now - lastAnimationFrame < 32) { requestRender(); return; }
      if (lastFrame) activeSeconds += Math.min((now - lastFrame) / 1000, 0.08);
      const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.08) : 1 / 30;
      lastFrame = now;
      lastAnimationFrame = now;
      controls.autoRotate = state.autoRotate && animate;
      controls.enableDamping = animate;
      controls.update(delta);
      printer.update(state.status, state.progress, state.lightOn, activeSeconds, animate);
      try {
        renderer.render(scene, camera);
      } catch {
        fail('三维渲染暂不可用，已切换为静态机型示意');
        return;
      }
      if (continuous || interacting || now < settlingUntil) requestRender();
      else { lastFrame = 0; lastAnimationFrame = 0; }
    }
    const onVisibility = () => { if (document.hidden) stop(); else requestRender(); };
    const onMotion = () => {
      reduceMotion = motionQuery.matches;
      setReducedMotion(reduceMotion);
      if (reduceMotion && controls) controls.autoRotate = false;
      requestRender();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      fail('WebGL 连接已中断，已切换为静态机型示意');
    };
    const onContextRestored = () => {
      contextLost = false;
      setFailure(null);
      setRestoreCount((count) => count + 1);
    };
    const onControlStart = () => { interacting = true; requestRender(); };
    const onControlEnd = () => { interacting = false; settlingUntil = performance.now() + 650; requestRender(); };
    const onControlChange = () => requestRender();
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      stop();
      handleRef.current = null;
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', resize);
      motionQuery.removeEventListener('change', onMotion);
      if (controls) {
        controls.removeEventListener('start', onControlStart);
        controls.removeEventListener('end', onControlEnd);
        controls.removeEventListener('change', onControlChange);
        controls.dispose();
      }
      if (printer) { scene.remove(printer.group); printer.dispose(); }
      scene.environment = null;
      environment?.dispose();
      pmrem?.dispose();
      room?.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight || object instanceof THREE.PointLight) object.shadow.dispose();
      });
      disposeModel(scene);
      if (renderer) {
        const canvas = renderer.domElement;
        canvas.removeEventListener('webglcontextlost', onContextLost);
        canvas.removeEventListener('webglcontextrestored', onContextRestored);
        renderer.renderLists.dispose();
        renderer.dispose();
        if (!contextLost) renderer.forceContextLoss();
        canvas.remove();
      }
    };
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const canvas = renderer.domElement;
      canvas.className = 'scene-canvas';
      canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;outline-offset:-3px';
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', '打印机三维机型示意，可拖动旋转，方向键旋转，滚轮缩放');
      canvas.setAttribute('aria-describedby', captionId);
      canvas.addEventListener('webglcontextlost', onContextLost, false);
      canvas.addEventListener('webglcontextrestored', onContextRestored, false);
      host.appendChild(canvas);
      pmrem = new THREE.PMREMGenerator(renderer);
      room = new RoomEnvironment();
      environment = pmrem.fromScene(room, 0.05);
      scene.environment = environment.texture;
      room.dispose();
      room = null;
      pmrem.dispose();
      pmrem = null;
      scene.environmentIntensity = 0.65;
      scene.add(new THREE.HemisphereLight('#e8f2f0', '#a1aaa6', 2.4));
      const key = new THREE.DirectionalLight('#fff4e5', 4.7);
      key.position.set(-3, 6.5, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -3.5;
      key.shadow.camera.right = 3.5;
      key.shadow.camera.top = 4;
      key.shadow.camera.bottom = -3.5;
      key.shadow.normalBias = 0.025;
      key.shadow.bias = -0.0002;
      key.shadow.radius = 4;
      scene.add(key);
      const fill = new THREE.DirectionalLight('#d6e8fa', 2.2);
      fill.position.set(4, 3, -3);
      scene.add(fill);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.15 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.005;
      ground.receiveShadow = true;
      scene.add(ground);
      controls = new OrbitControls(camera, canvas);
      controls.enablePan = false;
      controls.enableDamping = !reduceMotion;
      controls.dampingFactor = 0.085;
      controls.rotateSpeed = 0.65;
      controls.zoomSpeed = 0.65;
      controls.minPolarAngle = 0.35;
      controls.maxPolarAngle = Math.PI / 2 - 0.025;
      controls.autoRotateSpeed = 0.55;
      // Explicit keyboard orbit keeps the canvas usable without a pointing device.
      const onKey = (event: KeyboardEvent) => {
        if (!controls) return;
        const offset = camera.position.clone().sub(controls.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        if (event.key === 'ArrowLeft') spherical.theta -= 0.1;
        else if (event.key === 'ArrowRight') spherical.theta += 0.1;
        else if (event.key === 'ArrowUp') spherical.phi -= 0.08;
        else if (event.key === 'ArrowDown') spherical.phi += 0.08;
        else if (event.key === 'Home') { event.preventDefault(); resetCamera(); return; }
        else return;
        event.preventDefault();
        spherical.phi = THREE.MathUtils.clamp(spherical.phi, controls.minPolarAngle, controls.maxPolarAngle);
        camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
        controls.update();
        requestRender();
      };
      canvas.addEventListener('keydown', onKey);
      // OrbitControls.dispose removes its listeners; our listener leaves with the owned canvas.
      controls.addEventListener('start', onControlStart);
      controls.addEventListener('end', onControlEnd);
      controls.addEventListener('change', onControlChange);
      const setModel = (name: string) => {
        const nextKind = identifyPrinterModel(name).kind;
        if (nextKind === currentKind) return;
        if (printer) { scene.remove(printer.group); printer.dispose(); }
        printer = createPrinterModel(name);
        currentKind = nextKind;
        scene.add(printer.group);
        resetCamera();
      };
      handleRef.current = { reset: resetCamera, invalidate: requestRender, setModel };
      setModel(stateRef.current.model);
      setFailure(null);
      setReducedMotion(reduceMotion);
      document.addEventListener('visibilitychange', onVisibility);
      motionQuery.addEventListener('change', onMotion);
      window.addEventListener('resize', resize);
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);
      }
      if (typeof IntersectionObserver !== 'undefined') {
        intersectionObserver = new IntersectionObserver(([entry]) => {
          visible = entry?.isIntersecting ?? false;
          if (visible) requestRender(); else stop();
        }, { threshold: 0.01 });
        intersectionObserver.observe(host);
      }
      resize();
      requestRender();
    } catch {
      cleanup();
      setFailure('当前设备无法启用 WebGL，显示静态机型示意');
    }
    return cleanup;
    // Only mount/unmount (or context restore) owns the renderer. Props below update existing resources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreCount]);

  useEffect(() => {
    handleRef.current?.setModel(model);
    handleRef.current?.invalidate();
  }, [model, status, progress, lightOn, autoRotate]);

  const progressLabel = typeof progress === 'number' && Number.isFinite(progress)
    ? ` · ${Math.round(THREE.MathUtils.clamp(progress, 0, 100))}%` : '';

  return (
    <div className={`scene-shell ${failure ? 'scene-unavailable' : ''}`} data-model={info.kind} style={{ position: 'relative', width: '100%', height: 320, minWidth: 0, overflow: 'hidden', isolation: 'isolate' }}>
      <div ref={mountRef} className="scene-viewport" style={{ position: 'absolute', inset: 0, visibility: failure ? 'hidden' : 'visible' }} />
      <div className="scene-caption" id={captionId} style={{ position: 'absolute', left: 14, top: 12, pointerEvents: 'none', zIndex: 2 }}>
        <span className="scene-disclaimer">机型示意 · 非摄像头</span>
        <span className="scene-model-label" style={{ display: 'block' }}>{info.label}</span>
      </div>
      <div className="scene-toolbar" role="group" aria-label="三维视角控制" style={{ position: 'absolute', right: 10, top: 10, display: 'flex', gap: 5, zIndex: 3 }}>
        <button type="button" className="scene-button scene-reset" title="复位视角" aria-label="复位三维视角" disabled={!!failure} onClick={() => handleRef.current?.reset()}>
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 8a6 6 0 1 1 .4 5M4 3v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="scene-button scene-autorotate" title={reducedMotion ? '系统已设置减少动态效果' : '自动旋转'} aria-label="自动旋转三维模型" aria-pressed={autoRotate && !reducedMotion} disabled={!!failure || reducedMotion} onClick={() => setAutoRotate((value) => !value)}>
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m8 4 7 6-7 6V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M4 4v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
      {failure && <div className="scene-fallback" role="status" style={{ position: 'absolute', inset: '60px 20px 32px', display: 'grid', justifyItems: 'center', alignContent: 'center', gap: 8, textAlign: 'center' }}>
        <svg width="180" height="155" viewBox="0 0 180 155" fill="none" aria-hidden="true">
          <path d="m32 24 91-14 30 23v99l-91 15-30-23V24Z" fill="#cbd4cf" stroke="#76877f" strokeWidth="2" />
          <path d="m62 47 91-14v99l-91 15V47Z" fill="#e7ede8" stroke="#76877f" strokeWidth="2" />
          <path d="m32 24 30 23M62 47v100M44 56l-1 55 79 12 19-6" stroke="#76877f" strokeWidth="2" />
          <path d="m73 118 65-10-19-12-65 10 19 12Z" fill="#687c70" />
          <path d="m88 110 19-3v-25l-19 3v25Z" fill="#80b75e" /><path d="m88 85 19-3-9-6-19 3 9 6Z" fill="#a8cd87" />
          <path d="m70 68 70-10M100 65v13" stroke="#556a5d" strokeWidth="5" /><rect x="44" y="29" width="18" height="12" rx="2" fill="#5e7467" />
        </svg>
        <span>{failure}</span>
        <small>{STATUS_TEXT[status]}{progressLabel} · 状态数据仍可正常查看</small>
      </div>}
      <div className="scene-hint" style={{ position: 'absolute', left: 14, right: 14, bottom: 10, pointerEvents: 'none', zIndex: 2, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{failure ? '静态示意' : '拖动旋转 · 滚轮缩放'}</span>
        <span>{status === 'printing' && !reducedMotion && !failure ? '运动仅作示意' : reducedMotion ? '已减少动态效果' : STATUS_TEXT[status]}</span>
      </div>
    </div>
  );
}