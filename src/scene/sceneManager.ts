import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { PageId, QualityMode, Vec2 } from '../types';
import { Tweens, ease } from '../core/tween';
import { glowTexture } from './textures';

export interface Framing {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

const FRAMINGS: Record<PageId, Framing> = {
  interactive: { position: new THREE.Vector3(0, 0.14, 7.15), target: new THREE.Vector3(0, 0, 0), fov: 42 },
  knowledge: { position: new THREE.Vector3(0, 0.85, 16.4), target: new THREE.Vector3(0, 0.5, 0), fov: 42 },
  test: { position: new THREE.Vector3(0, 0.4, 10.6), target: new THREE.Vector3(0, 0, 0), fov: 42 }
};

/**
 * One renderer, one scene, one camera. Pages live in sibling groups and the camera
 * flies between three fixed framings (DECISIONS D-07).
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly tweens = new Tweens();

  readonly labGroup = new THREE.Group();
  readonly knowledgeGroup = new THREE.Group();
  readonly testGroup = new THREE.Group();
  readonly handGroup = new THREE.Group();

  readonly target = new THREE.Vector3();

  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private dust: THREE.Points | null = null;
  private dustSpeed: Float32Array | null = null;
  private environment: THREE.Texture | null = null;
  private quality: QualityMode = 'high';
  private page: PageId = 'interactive';
  private transitioning = false;

  constructor(mount: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(mount.clientWidth || window.innerWidth, mount.clientHeight || window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'celly-canvas';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    mount.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      FRAMINGS.interactive.fov,
      (mount.clientWidth || window.innerWidth) / (mount.clientHeight || window.innerHeight),
      0.05,
      120
    );
    this.camera.position.copy(FRAMINGS.interactive.position);
    this.camera.lookAt(FRAMINGS.interactive.target);
    this.target.copy(FRAMINGS.interactive.target);

    this.scene.background = new THREE.Color('#04080f');
    this.scene.fog = new THREE.FogExp2('#04080f', 0.028);

    this.scene.add(this.labGroup, this.knowledgeGroup, this.testGroup, this.handGroup);
    this.knowledgeGroup.visible = false;
    this.testGroup.visible = false;

    this.setupLighting();
    this.setupFloor();
    this.setupDust();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.34, 0.5, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  private setupLighting(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    this.environment = pmrem.fromScene(env, 0.04).texture;
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 0.3;
    env.dispose();
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight('#3a7d9e', '#050a14', 0.55);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight('#c8ecff', 1.65);
    key.position.set(4.5, 7.5, 5.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 28;
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.bias = -0.0007;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight('#7b6bff', 1.2);
    rim.position.set(-6, 2.5, -5);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight('#2f9fd1', 0.5);
    fill.position.set(-3, -2, 4);
    this.scene.add(fill);

    const warm = new THREE.PointLight('#ffb347', 14, 14, 2);
    warm.position.set(3.2, -1.2, 3.4);
    this.scene.add(warm);

    const core = new THREE.PointLight('#9fdcff', 10, 7, 2);
    core.position.set(0, 0, 0);
    this.scene.add(core);
  }

  private setupFloor(): void {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#050b13';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(90,190,235,0.20)';
      ctx.lineWidth = 1.4;
      const step = size / 16;
      for (let i = 0; i <= 16; i++) {
        ctx.beginPath();
        ctx.moveTo(i * step, 0);
        ctx.lineTo(i * step, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * step);
        ctx.lineTo(size, i * step);
        ctx.stroke();
      }
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(74,200,255,0.30)');
      g.addColorStop(0.42, 'rgba(40,120,180,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0.95)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

    const floorMat = new THREE.MeshStandardMaterial({
      map: tex,
      color: new THREE.Color('#9fd8ef'),
      roughness: 0.72,
      metalness: 0.35,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(15, 96), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.15;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.35, 0.006, 6, 180),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#4fd8ff'),
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -2.14;
    this.scene.add(ring);

    const innerRing = ring.clone();
    innerRing.scale.setScalar(0.72);
    (innerRing.material as THREE.MeshBasicMaterial).opacity = 0.3;
    this.scene.add(innerRing);
  }

  private setupDust(): void {
    const count = 420;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 18;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 9;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 14;
      speeds[i] = 0.02 + Math.random() * 0.08;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color('#8fd3ff'),
      size: 0.028,
      // Without a map a point sprite is a hard-edged square; one close particle in the corner
      // was visible as a blue tile on the page edge.
      map: glowTexture(),
      alphaTest: 0.01,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    this.dust = new THREE.Points(geo, mat);
    this.dustSpeed = speeds;
    this.scene.add(this.dust);
  }

  // ------------------------------------------------------------------ navigation

  goToPage(page: PageId, animate = true): void {
    if (this.page === page && !this.transitioning) return;
    this.page = page;
    const framing = FRAMINGS[page];
    this.transitioning = animate;
    const fromPos = this.camera.position.clone();
    const fromTarget = this.target.clone();
    if (!animate) {
      this.camera.position.copy(framing.position);
      this.target.copy(framing.target);
      this.camera.lookAt(this.target);
      this.transitioning = false;
    } else {
      this.tweens.add(
        780,
        (t) => {
          this.camera.position.lerpVectors(fromPos, framing.position, t);
          this.target.lerpVectors(fromTarget, framing.target, t);
        },
        ease.inOutCubic,
        () => {
          this.transitioning = false;
        }
      );
    }
    this.camera.fov = framing.fov;
    this.camera.updateProjectionMatrix();
  }

  get currentPage(): PageId {
    return this.page;
  }

  /** Nudge the camera for a "fly to" feel without moving it off its framing. */
  nudgeCamera(offset: THREE.Vector3, duration = 700): void {
    const framing = FRAMINGS[this.page];
    const from = this.camera.position.clone();
    const to = framing.position.clone().add(offset);
    this.tweens.add(duration, (t) => this.camera.position.lerpVectors(from, to, t), ease.inOutCubic);
  }

  resetCamera(duration = 700): void {
    const framing = FRAMINGS[this.page];
    const from = this.camera.position.clone();
    this.tweens.add(duration, (t) => this.camera.position.lerpVectors(from, framing.position, t), ease.inOutCubic);
  }

  // --------------------------------------------------------------------- quality

  setQuality(quality: QualityMode): void {
    this.quality = quality;
    const dpr = quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = quality === 'high';
    this.bloom.enabled = quality === 'high';
    this.composer.setPixelRatio(dpr);
    this.onResize();
  }

  get currentQuality(): QualityMode {
    return this.quality;
  }

  // ---------------------------------------------------------------------- picking

  ndcFromPixels(x: number, y: number): Vec2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: ((x - rect.left) / rect.width) * 2 - 1,
      y: -(((y - rect.top) / rect.height) * 2 - 1)
    };
  }

  rayFromPixels(x: number, y: number, raycaster = new THREE.Raycaster()): THREE.Raycaster {
    const ndc = this.ndcFromPixels(x, y);
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    return raycaster;
  }

  projectToScreen(world: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const p = world.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
      visible: p.z > -1 && p.z < 1
    };
  }

  // ---------------------------------------------------------------------- render

  render(dt: number): void {
    this.tweens.update(dt * 1000);

    if (this.dust && this.dustSpeed) {
      const pos = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + this.dustSpeed[i] * dt;
        if (y > 4.5) y = -4.5;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      this.dust.rotation.y += dt * 0.006;
    }

    // Smooth the look-at target so camera tweens never snap.
    const current = new THREE.Vector3();
    this.camera.getWorldDirection(current);
    const look = this.camera.position.clone().add(current.multiplyScalar(6));
    look.lerp(this.target, 0.18);
    this.camera.lookAt(look);

    if (this.quality === 'high') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  };

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.environment?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
