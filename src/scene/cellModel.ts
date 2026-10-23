import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CellPart, OrganelleId } from './types';
import {
  blobGeometry,
  centrioleGeometry,
  ellipsoidGeometry,
  golgiCisternaGeometry,
  granuleCluster,
  microtubuleGeometry,
  ribbonGeometry,
  sphereSurfacePoints,
  tubeGeometry
} from './shapes';
import { cristaeTexture, glowTexture, grainTexture, speckleTexture } from './textures';
import { makeRng, range, damp } from '../core/math';
import { ORGANELLE_BY_ID } from '../data/catalog';

export interface CellModelOptions {
  onPartBuilt?: (id: OrganelleId) => void;
}

interface OpacityTarget {
  mat: THREE.Material;
  base: number;
  /** Custom uniform-based opacity setter (shader materials). */
  set?: (v: number) => void;
}

interface EmissiveTarget {
  mat: THREE.MeshStandardMaterial;
  base: number;
}

const GHOST = 0.1;

/**
 * Structural weight of each part, used to break ties when a single ray crosses several
 * of them (DECISIONS D-19). A shell — the membrane, the cytoplasm, the nuclear envelope —
 * swallows everything behind it, so it only wins when nothing more specific is under the
 * cursor. That keeps the nucleus clickable through its own envelope.
 */
const PICK_PRIORITY: Partial<Record<OrganelleId, number>> = {
  membrane: 0,
  cytoplasm: 1,
  cytoskeleton: 2,
  'nuclear-envelope': 3,
  nucleus: 4,
  ribosome: 5
};
const PICK_DEFAULT = 6;

export class CellModel {
  readonly root = new THREE.Group();
  readonly parts = new Map<OrganelleId, CellPart>();
  readonly order: OrganelleId[] = [];

  selected: OrganelleId | null = null;
  hovered: OrganelleId | null = null;
  isolation: OrganelleId | null = null;

  private readonly halo: THREE.Mesh;
  private haloMaterial: THREE.ShaderMaterial;
  private opacityTargets = new Map<OrganelleId, OpacityTarget[]>();
  private emissiveTargets = new Map<OrganelleId, EmissiveTarget[]>();
  private emphasis = new Map<OrganelleId, number>();
  private opacityScale = new Map<OrganelleId, number>();
  private disposed = false;

  constructor() {
    this.root.name = 'cell';
    this.buildMembrane();
    this.buildCytoplasm();
    this.buildNucleus();
    this.buildMitochondria();
    this.buildRoughER();
    this.buildSmoothER();
    this.buildGolgi();
    this.buildRibosomes();
    this.buildLysosomes();
    this.buildVacuoles();
    this.buildCentrioles();
    this.buildCytoskeleton();
    this.buildPeroxisomes();

    this.haloMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color('#ffb347') },
        uIntensity: { value: 0.9 },
        uTime: { value: 0 }
      },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uIntensity;
        uniform float uTime;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.1);
          float pulse = 0.82 + 0.18 * sin(uTime * 2.4);
          float a = f * 0.55 * uIntensity * pulse;
          gl_FragColor = vec4(uColor * (1.0 + f * 2.0), a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), this.haloMaterial);
    this.halo.visible = false;
    this.halo.renderOrder = 6;
    this.root.add(this.halo);

    this.finalizeParts();
  }

  // --------------------------------------------------------------------- build

  private newPart(id: OrganelleId): { part: CellPart; group: THREE.Group; color: string } {
    const meta = ORGANELLE_BY_ID.get(id);
    const color = meta?.color ?? '#8fd3ff';
    const group = new THREE.Group();
    group.name = `part:${id}`;
    group.userData.partId = id;
    this.root.add(group);
    const part: CellPart = {
      id,
      label: meta?.name.en ?? id,
      group,
      center: new THREE.Vector3(),
      radius: 0.3,
      basePosition: new THREE.Vector3(),
      baseRotation: new THREE.Euler(),
      phase: Math.random() * Math.PI * 2,
      bobAmp: 0.012,
      bobSpeed: 0.6,
      spin: new THREE.Vector3(0, 0.12, 0)
    };
    this.parts.set(id, part);
    this.order.push(id);
    this.opacityTargets.set(id, []);
    this.emissiveTargets.set(id, []);
    this.emphasis.set(id, 0);
    this.opacityScale.set(id, 1);
    return { part, group, color };
  }

  private trackOpacity(id: OrganelleId, mat: THREE.Material, base: number, set?: (v: number) => void): void {
    this.opacityTargets.get(id)?.push({ mat, base, set });
  }

  private trackEmissive(id: OrganelleId, mat: THREE.MeshStandardMaterial): void {
    this.emissiveTargets.get(id)?.push({ mat, base: mat.emissiveIntensity });
  }

  private standard(
    color: string,
    opts: {
      roughness?: number;
      metalness?: number;
      emissive?: string;
      emissiveIntensity?: number;
      opacity?: number;
      depthWrite?: boolean;
      flatShading?: boolean;
      side?: THREE.Side;
    } = {}
  ): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: opts.roughness ?? 0.52,
      metalness: opts.metalness ?? 0.15,
      emissive: new THREE.Color(opts.emissive ?? color),
      emissiveIntensity: opts.emissiveIntensity ?? 0.12,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
      depthWrite: opts.depthWrite ?? (opts.opacity ?? 1) > 0.85,
      flatShading: opts.flatShading ?? false,
      side: opts.side ?? THREE.FrontSide
    });
  }

  private buildMembrane(): void {
    const { group } = this.newPart('membrane');

    const glass = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color('#4cc9f0') },
        uOpacity: { value: 1 },
        uTime: { value: 0 }
      },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          vP = position;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          float f = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.4);
          float weave = 0.94 + 0.06 * sin(vP.y * 30.0 + uTime * 0.6) * cos(vP.x * 26.0);
          vec3 col = uColor * (0.06 + f * 0.9) * weave;
          gl_FragColor = vec4(col, uOpacity * (0.022 + f * 0.26));
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const rim = new THREE.Mesh(new THREE.SphereGeometry(1.56, 96, 64), glass);
    rim.userData.partId = 'membrane';
    group.add(rim);
    this.trackOpacity('membrane', glass, 1, (v) => {
      glass.uniforms.uOpacity.value = v;
    });
    (glass as THREE.ShaderMaterial).userData.timeUniform = glass.uniforms.uTime;

    const skin = new THREE.Mesh(
      new THREE.SphereGeometry(1.548, 64, 48),
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#0b3d55'),
        roughness: 0.28,
        metalness: 0.0,
        transmission: 0,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        side: THREE.FrontSide
      })
    );
    skin.userData.partId = 'membrane';
    group.add(skin);
    this.trackOpacity('membrane', skin.material, 0.05);

    // A faint halo just outside the membrane sells the "contained" look.
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(1.72, 48, 32),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#2f9fd1'),
        transparent: true,
        opacity: 0.022,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide
      })
    );
    aura.userData.partId = 'membrane';
    group.add(aura);
    this.trackOpacity('membrane', aura.material, 0.022);
  }

  private buildCytoplasm(): void {
    const { group } = this.newPart('cytoplasm');

    const body = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 48, 32),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#0a3f5c'),
        emissive: new THREE.Color('#052a40'),
        emissiveIntensity: 0.35,
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
        side: THREE.BackSide
      })
    );
    body.userData.partId = 'cytoplasm';
    group.add(body);
    this.trackOpacity('cytoplasm', body.material, 0.07);

    const rng = makeRng(5561);
    const count = 1200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rng() * 2 - 1;
      const t = rng() * Math.PI * 2;
      const r = Math.cbrt(rng()) * 1.42;
      const s = Math.sqrt(1 - u * u);
      positions[i * 3] = s * Math.cos(t) * r;
      positions[i * 3 + 1] = u * r;
      positions[i * 3 + 2] = s * Math.sin(t) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: new THREE.Color('#7fd8ff'),
        size: 0.019,
        map: speckleTexture(),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
      })
    );
    points.userData.partId = 'cytoplasm';
    group.add(points);
    this.trackOpacity('cytoplasm', points.material, 0.4);
  }

  private buildNucleus(): void {
    const { group } = this.newPart('nucleus');
    group.position.set(-0.12, 0.08, 0.04);

    const body = new THREE.Mesh(
      blobGeometry(0.5, 4, 0.045, 3),
      this.standard('#4b32c3', {
        roughness: 0.58,
        metalness: 0.08,
        emissive: '#4326b8',
        emissiveIntensity: 0.32,
        opacity: 0.72,
        flatShading: false
      })
    );
    body.material.bumpMap = grainTexture(256, 12);
    body.material.bumpScale = 0.012;
    body.userData.partId = 'nucleus';
    group.add(body);
    this.trackOpacity('nucleus', body.material, 0.72);
    this.trackEmissive('nucleus', body.material as THREE.MeshStandardMaterial);

    // Chromatin speckle inside the nucleus.
    const rng = makeRng(3312);
    const count = 520;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rng() * 2 - 1;
      const t = rng() * Math.PI * 2;
      const r = Math.cbrt(rng()) * 0.46;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = s * Math.cos(t) * r;
      pos[i * 3 + 1] = u * r;
      pos[i * 3 + 2] = s * Math.sin(t) * r;
    }
    const speckleGeo = new THREE.BufferGeometry();
    speckleGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const speckle = new THREE.Points(
      speckleGeo,
      new THREE.PointsMaterial({
        color: new THREE.Color('#b7a4ff'),
        size: 0.026,
        map: glowTexture(),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    speckle.userData.partId = 'nucleus';
    group.add(speckle);
    this.trackOpacity('nucleus', speckle.material, 0.5);

    // Nuclear envelope sits on its own part so it can be isolated.
    const env = this.newPart('nuclear-envelope');
    env.group.position.copy(group.position);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.545, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color('#9d8aff') }, uOpacity: { value: 1 }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vN = normalize(mat3(modelMatrix) * normal);
            vV = normalize(cameraPosition - wp.xyz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uOpacity;
          varying vec3 vN; varying vec3 vV;
          void main() {
            float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
            gl_FragColor = vec4(uColor * (0.25 + f * 1.8), uOpacity * (0.06 + f * 0.55));
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      })
    );
    shell.userData.partId = 'nuclear-envelope';
    env.group.add(shell);
    this.trackOpacity('nuclear-envelope', shell.material, 1, (v) => {
      (shell.material as THREE.ShaderMaterial).uniforms.uOpacity.value = v;
    });

    const pores = new THREE.Points(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(sphereSurfacePoints(190, 0.552, 91), 3)
      ),
      new THREE.PointsMaterial({
        color: new THREE.Color('#ffd9f2'),
        size: 0.022,
        map: glowTexture(),
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    pores.userData.partId = 'nuclear-envelope';
    env.group.add(pores);
    this.trackOpacity('nuclear-envelope', pores.material, 0.75);

    const nucleolus = this.newPart('nucleolus');
    nucleolus.group.position.set(0.02, 0.11, 0.12);
    const nuc = new THREE.Mesh(
      blobGeometry(0.19, 3, 0.09, 8),
      this.standard('#ff3d7f', { roughness: 0.45, emissive: '#ff2f74', emissiveIntensity: 0.55 })
    );
    nuc.userData.partId = 'nucleolus';
    nucleolus.group.add(nuc);
    this.trackOpacity('nucleolus', nuc.material, 1);
    this.trackEmissive('nucleolus', nuc.material as THREE.MeshStandardMaterial);
  }

  private buildMitochondria(): void {
    const { group } = this.newPart('mitochondrion');
    const cristae = cristaeTexture();
    const geo = ellipsoidGeometry(0.235, 0.115, 0.115, 3);
    const placements: Array<[THREE.Vector3, THREE.Euler, number]> = [
      [new THREE.Vector3(0.66, 0.55, 0.34), new THREE.Euler(0.4, 0.6, 0.3), 1.0],
      [new THREE.Vector3(-0.74, -0.46, 0.5), new THREE.Euler(1.1, -0.4, 0.8), 0.86],
      [new THREE.Vector3(0.36, -0.78, -0.5), new THREE.Euler(-0.5, 0.3, 1.2), 0.92],
      [new THREE.Vector3(-0.58, 0.8, -0.28), new THREE.Euler(0.8, 1.2, -0.4), 0.76],
      [new THREE.Vector3(0.98, -0.18, -0.5), new THREE.Euler(0.2, -1.0, 0.5), 0.72],
      [new THREE.Vector3(-0.95, 0.14, -0.58), new THREE.Euler(1.4, 0.2, -0.7), 0.8]
    ];
    for (const [pos, rot, scale] of placements) {
      const mat = this.standard('#ff8a3d', {
        roughness: 0.42,
        metalness: 0.2,
        emissive: '#ff6a1f',
        emissiveIntensity: 0.22
      });
      mat.emissiveMap = cristae;
      mat.bumpMap = cristae;
      mat.bumpScale = 0.012;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.rotation.copy(rot);
      mesh.scale.setScalar(scale);
      mesh.userData.partId = 'mitochondrion';
      group.add(mesh);
      this.trackOpacity('mitochondrion', mat, 1);
      this.trackEmissive('mitochondrion', mat);
    }
  }

  private buildRoughER(): void {
    const { group } = this.newPart('rough-er');
    const sheets: Array<[THREE.Vector3, THREE.Euler, number, number]> = [
      [new THREE.Vector3(-0.62, 0.22, 0.3), new THREE.Euler(0.3, 0.7, 0.2), 0.75, 0.42],
      [new THREE.Vector3(-0.6, -0.3, 0.18), new THREE.Euler(-0.4, 1.2, -0.3), 0.7, 0.36],
      [new THREE.Vector3(0.35, 0.52, 0.42), new THREE.Euler(0.9, -0.4, 0.5), 0.62, 0.32],
      [new THREE.Vector3(-0.15, 0.72, -0.15), new THREE.Euler(1.3, 0.3, 1.1), 0.58, 0.3],
      [new THREE.Vector3(0.5, -0.5, 0.35), new THREE.Euler(-0.7, 0.9, 0.4), 0.55, 0.28]
    ];
    sheets.forEach(([pos, rot, length, width], i) => {
      const mat = this.standard(i % 2 ? '#d78bff' : '#e9a0ff', {
        roughness: 0.55,
        metalness: 0.05,
        emissive: '#c77dff',
        emissiveIntensity: 0.18,
        opacity: 0.92,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(ribbonGeometry(length, width, { waveAmp: 0.05, waveFreq: 2.2, seed: i + 1 }), mat);
      mesh.position.copy(pos);
      mesh.rotation.copy(rot);
      mesh.userData.partId = 'rough-er';
      group.add(mesh);
      this.trackOpacity('rough-er', mat, 0.92);
      this.trackEmissive('rough-er', mat);

      // Ribosomes studding the sheet.
      const dots = new THREE.Mesh(granuleCluster(16, Math.min(length, width) * 0.55, 40 + i), this.standard('#ffd166', {
        roughness: 0.4,
        emissive: '#ffc23d',
        emissiveIntensity: 0.45
      }));
      dots.position.copy(pos);
      dots.rotation.copy(rot);
      dots.userData.partId = 'rough-er';
      group.add(dots);
      this.trackOpacity('rough-er', dots.material, 1);
      this.trackEmissive('rough-er', dots.material as THREE.MeshStandardMaterial);
    });
  }

  private buildSmoothER(): void {
    const { group } = this.newPart('smooth-er');
    const rng = makeRng(2207);
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const start = new THREE.Vector3(range(rng, -1.15, 1.15), range(rng, -0.9, 0.9), range(rng, -0.9, 0.9));
      if (start.length() > 1.32) start.setLength(range(rng, 0.6, 1.2));
      const pts = [start];
      let cur = start.clone();
      for (let k = 0; k < 4; k++) {
        cur = cur
          .clone()
          .add(new THREE.Vector3(range(rng, -0.24, 0.24), range(rng, -0.24, 0.24), range(rng, -0.24, 0.24)));
        if (cur.length() > 1.34) cur.setLength(1.28);
        pts.push(cur.clone());
      }
      parts.push(tubeGeometry(pts, 0.018, 5, 24));
    }
    const merged = parts.length > 1 ? mergeGeometries(parts, false) : (parts[0] ?? null);
    parts.forEach((p) => p.dispose());
    if (merged) {
      const mat = this.standard('#c77dff', {
        roughness: 0.5,
        emissive: '#a855f7',
        emissiveIntensity: 0.24
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.userData.partId = 'smooth-er';
      group.add(mesh);
      this.trackOpacity('smooth-er', mat, 1);
      this.trackEmissive('smooth-er', mat);
    }
  }

  private buildGolgi(): void {
    const { group } = this.newPart('golgi');
    group.position.set(-0.7, 0.66, 0.3);
    group.rotation.set(0.5, 0.4, 0.6);
    for (let i = 0; i < 5; i++) {
      const r = 0.2 - i * 0.022;
      const mat = this.standard(i % 2 ? '#ffc23d' : '#ffd166', {
        roughness: 0.38,
        metalness: 0.25,
        emissive: '#ffb020',
        emissiveIntensity: 0.25,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(golgiCisternaGeometry(r, Math.PI * 1.28, 0.018), mat);
      mesh.position.y = i * 0.042 - 0.084;
      mesh.userData.partId = 'golgi';
      group.add(mesh);
      this.trackOpacity('golgi', mat, 1);
      this.trackEmissive('golgi', mat);
    }
    const vesicles = new THREE.Mesh(
      granuleCluster(12, 0.2, 77),
      this.standard('#ffe08a', { roughness: 0.35, emissive: '#ffc23d', emissiveIntensity: 0.4 })
    );
    vesicles.userData.partId = 'golgi';
    group.add(vesicles);
    this.trackOpacity('golgi', vesicles.material, 1);
    this.trackEmissive('golgi', vesicles.material as THREE.MeshStandardMaterial);
  }

  private buildRibosomes(): void {
    const { group } = this.newPart('ribosome');
    const rng = makeRng(8811);
    const count = 460;
    const geo = new THREE.IcosahedronGeometry(0.0135, 0);
    const mat = this.standard('#f4e285', { roughness: 0.4, emissive: '#ffe066', emissiveIntensity: 0.5 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.userData.partId = 'ribosome';
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    let placed = 0;
    let guard = count * 40;
    while (placed < count && guard-- > 0) {
      const u = rng() * 2 - 1;
      const t = rng() * Math.PI * 2;
      const r = 0.62 + Math.cbrt(rng()) * 0.78;
      const sq = Math.sqrt(1 - u * u);
      p.set(sq * Math.cos(t) * r, u * r, sq * Math.sin(t) * r);
      if (p.distanceTo(new THREE.Vector3(-0.12, 0.08, 0.04)) < 0.58) continue;
      if (p.length() > 1.4) continue;
      q.setFromAxisAngle(new THREE.Vector3(rng(), rng(), rng()).normalize(), rng() * Math.PI);
      s.setScalar(0.7 + rng() * 0.8);
      m.compose(p, q, s);
      inst.setMatrixAt(placed++, m);
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    this.trackOpacity('ribosome', mat, 1);
    this.trackEmissive('ribosome', mat);
  }

  private buildLysosomes(): void {
    const { group } = this.newPart('lysosome');
    const rng = makeRng(4417);
    for (let i = 0; i < 7; i++) {
      const p = randomInterior(rng, 0.62, 1.3, new THREE.Vector3(-0.12, 0.08, 0.04), 0.62);
      const r = 0.055 + rng() * 0.045;
      const mat = this.standard('#2ec4b6', {
        roughness: 0.36,
        metalness: 0.2,
        emissive: '#1fa89c',
        emissiveIntensity: 0.35
      });
      const mesh = new THREE.Mesh(blobGeometry(r, 2, 0.16, 120 + i), mat);
      mesh.position.copy(p);
      mesh.userData.partId = 'lysosome';
      group.add(mesh);
      this.trackOpacity('lysosome', mat, 1);
      this.trackEmissive('lysosome', mat);
    }
  }

  private buildVacuoles(): void {
    const { group } = this.newPart('vacuole');
    const spots: Array<[THREE.Vector3, number]> = [
      [new THREE.Vector3(0.82, 0.32, 0.42), 0.15],
      [new THREE.Vector3(-0.2, -0.95, 0.36), 0.115],
      [new THREE.Vector3(0.22, 0.95, -0.42), 0.095]
    ];
    for (const [p, r] of spots) {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#5ec8ff'),
        emissive: new THREE.Color('#2f9fd1'),
        emissiveIntensity: 0.3,
        roughness: 0.15,
        metalness: 0.0,
        transparent: true,
        opacity: 0.2,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), mat);
      mesh.position.copy(p);
      mesh.userData.partId = 'vacuole';
      group.add(mesh);
      this.trackOpacity('vacuole', mat, 0.2);
      this.trackEmissive('vacuole', mat);
    }
  }

  private buildCentrioles(): void {
    const { group } = this.newPart('centriole');
    group.position.set(0.1, 0.62, -0.34);
    const geo = centrioleGeometry();
    const mat = this.standard('#9aa0a8', { roughness: 0.3, metalness: 0.75, emissive: '#7f8fa6', emissiveIntensity: 0.2 });
    const a = new THREE.Mesh(geo, mat);
    a.rotation.set(0.3, 0.2, 0.7);
    a.userData.partId = 'centriole';
    group.add(a);
    const b = new THREE.Mesh(geo, mat);
    b.position.set(0.1, 0.02, 0.06);
    b.rotation.set(1.5, 0.7, 0.1);
    b.userData.partId = 'centriole';
    group.add(b);
    this.trackOpacity('centriole', mat, 1);
    this.trackEmissive('centriole', mat);
  }

  private buildCytoskeleton(): void {
    const { group } = this.newPart('cytoskeleton');
    const mat = this.standard('#6d8fb3', {
      roughness: 0.55,
      metalness: 0.3,
      emissive: '#4f7f9f',
      emissiveIntensity: 0.35,
      opacity: 0.42,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(microtubuleGeometry(34, 0.2, 1.32, 661), mat);
    mesh.userData.partId = 'cytoskeleton';
    group.add(mesh);
    this.trackOpacity('cytoskeleton', mat, 0.42);
    this.trackEmissive('cytoskeleton', mat);
  }

  private buildPeroxisomes(): void {
    const { group } = this.newPart('peroxisome');
    const rng = makeRng(9901);
    for (let i = 0; i < 5; i++) {
      const p = randomInterior(rng, 0.66, 1.28, new THREE.Vector3(-0.12, 0.08, 0.04), 0.66);
      const r = 0.045 + rng() * 0.03;
      const mat = this.standard('#b5e48c', {
        roughness: 0.4,
        metalness: 0.15,
        emissive: '#a3e635',
        emissiveIntensity: 0.3
      });
      const mesh = new THREE.Mesh(blobGeometry(r, 2, 0.14, 300 + i), mat);
      mesh.position.copy(p);
      mesh.userData.partId = 'peroxisome';
      group.add(mesh);
      this.trackOpacity('peroxisome', mat, 1);
      this.trackEmissive('peroxisome', mat);

      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(r * 0.34, 0),
        this.standard('#e9ffd0', { roughness: 0.2, metalness: 0.4, emissive: '#d9f99d', emissiveIntensity: 0.5 })
      );
      crystal.position.copy(p);
      crystal.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      crystal.userData.partId = 'peroxisome';
      group.add(crystal);
      this.trackOpacity('peroxisome', crystal.material as THREE.Material, 1);
      this.trackEmissive('peroxisome', crystal.material as THREE.MeshStandardMaterial);
    }
  }

  private finalizeParts(): void {
    const box = new THREE.Box3();
    const sphere = new THREE.Sphere();
    for (const part of this.parts.values()) {
      box.setFromObject(part.group);
      if (box.isEmpty()) continue;
      box.getBoundingSphere(sphere);
      part.center.copy(sphere.center);
      part.radius = Math.max(0.04, sphere.radius);
      part.basePosition.copy(part.group.position);
      part.baseRotation.copy(part.group.rotation);
      const rng = makeRng(part.id.length * 977 + part.id.charCodeAt(0));
      part.bobAmp = part.id === 'membrane' || part.id === 'cytoplasm' ? 0 : 0.008 + rng() * 0.012;
      part.bobSpeed = 0.35 + rng() * 0.5;
      part.phase = rng() * Math.PI * 2;
      part.spin.set((rng() - 0.5) * 0.08, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.08);
    }
  }

  // ------------------------------------------------------------------ interaction

  /**
   * Hit-test the cell. Shell and background systems (membrane, cytoplasm, cytoskeleton,
   * ribosomes) are only returned when nothing more specific sits under the ray, otherwise
   * the membrane would swallow every pick.
   */
  pick(raycaster: THREE.Raycaster): OrganelleId | null {
    const hits = raycaster.intersectObject(this.root, true);
    let best: OrganelleId | null = null;
    let bestScore = -1;
    for (const hit of hits) {
      const id = hit.object.userData.partId as OrganelleId | undefined;
      if (!id || !this.parts.has(id)) continue;
      const score = PICK_PRIORITY[id] ?? PICK_DEFAULT;
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
      if (bestScore === PICK_DEFAULT) break;
    }
    return best;
  }

  setIsolation(id: OrganelleId | null): void {
    this.isolation = id;
  }

  setSelected(id: OrganelleId | null): void {
    this.selected = id;
    this.halo.visible = !!id;
    if (id) {
      const part = this.parts.get(id);
      if (part) {
        this.halo.position.copy(part.group.position).add(part.center.clone().sub(part.basePosition));
        this.halo.scale.setScalar(part.radius * 1.35);
        this.haloMaterial.uniforms.uColor.value.set(ORGANELLE_BY_ID.get(id)?.color ?? '#ffb347');
      }
    }
    this.setIsolation(id);
  }

  setHovered(id: OrganelleId | null): void {
    this.hovered = id;
  }

  getPart(id: OrganelleId): CellPart | undefined {
    return this.parts.get(id);
  }

  /** Centre of a part in cell-root local space. */
  getCenter(id: OrganelleId): THREE.Vector3 {
    const part = this.parts.get(id);
    return part ? part.center.clone() : new THREE.Vector3();
  }

  getRadius(id: OrganelleId): number {
    return this.parts.get(id)?.radius ?? 0.3;
  }

  // ---------------------------------------------------------------------- update

  update(dt: number, elapsed: number): void {
    if (this.disposed) return;

    for (const part of this.parts.values()) {
      const targetEmphasis = this.selected === part.id ? 1 : this.hovered === part.id ? 0.55 : 0;
      const em = damp(this.emphasis.get(part.id) ?? 0, targetEmphasis, 9, dt);
      this.emphasis.set(part.id, em);

      const targetScale = this.isolation && this.isolation !== part.id ? GHOST : 1;
      const scale = damp(this.opacityScale.get(part.id) ?? 1, targetScale, 7, dt);
      this.opacityScale.set(part.id, scale);

      for (const t of this.opacityTargets.get(part.id) ?? []) {
        const v = t.base * scale;
        if (t.set) t.set(scale);
        else {
          const mat = t.mat as THREE.MeshStandardMaterial;
          mat.opacity = v;
          if (v < 0.985) mat.transparent = true;
          mat.depthWrite = v > 0.82 && !(mat.userData.noDepthWrite as boolean);
        }
      }

      for (const e of this.emissiveTargets.get(part.id) ?? []) {
        e.mat.emissiveIntensity = e.base + em * 0.85;
      }

      if (this.selected === part.id) {
        const pulse = 1 + Math.sin(elapsed * 2.2) * 0.012;
        part.group.scale.setScalar(pulse);
        part.group.rotation.copy(part.baseRotation);
        part.group.rotation.y = part.baseRotation.y + Math.sin(elapsed * 0.35) * 0.06;
      } else {
        part.group.scale.setScalar(1);
        part.group.rotation.copy(part.baseRotation);
      }

      if (part.bobAmp > 0) {
        part.group.position.copy(part.basePosition);
        part.group.position.y += Math.sin(elapsed * part.bobSpeed + part.phase) * part.bobAmp;
        part.group.position.x += Math.cos(elapsed * part.bobSpeed * 0.7 + part.phase) * part.bobAmp * 0.6;
      }
    }

    if (this.selected) {
      const part = this.parts.get(this.selected);
      if (part) {
        this.halo.position.copy(part.group.position).add(part.center.clone().sub(part.basePosition));
        this.halo.scale.setScalar(part.radius * (1.35 + Math.sin(elapsed * 2.2) * 0.03));
      }
      this.haloMaterial.uniforms.uTime.value = elapsed;
    }

    // Animate the membrane shader clock.
    for (const t of this.opacityTargets.get('membrane') ?? []) {
      const u = (t.mat as THREE.ShaderMaterial).userData?.timeUniform as { value: number } | undefined;
      if (u) u.value = elapsed;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => disposeMaterial(m));
      else if (mat) disposeMaterial(mat);
    });
    this.root.clear();
    this.parts.clear();
    this.order.length = 0;
  }
}

function randomInterior(rng: () => number, minR: number, maxR: number, avoid: THREE.Vector3, avoidR: number): THREE.Vector3 {
  for (let i = 0; i < 60; i++) {
    const u = rng() * 2 - 1;
    const t = rng() * Math.PI * 2;
    const r = range(rng, minR, maxR);
    const s = Math.sqrt(1 - u * u);
    const p = new THREE.Vector3(s * Math.cos(t) * r, u * r, s * Math.sin(t) * r);
    if (p.distanceTo(avoid) > avoidR) return p;
  }
  return new THREE.Vector3(minR, 0, 0);
}

function disposeMaterial(mat: THREE.Material): void {
  const anyMat = mat as THREE.MeshStandardMaterial;
  anyMat.map?.dispose();
  anyMat.emissiveMap?.dispose();
  anyMat.bumpMap?.dispose();
  mat.dispose();
}
