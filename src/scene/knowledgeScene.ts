import * as THREE from 'three';
import type { KnowledgeNode, Language } from '../types';
import { KNOWLEDGE_NODES, loc } from '../data/catalog';
import { layout3d, type LayoutEdge } from './knowledgeLayout';
import { layoutLabels, shortenLabel, type LabelBox } from './labelLayout';
import { labelTexture } from './textures';
import { Tweens, ease } from '../core/tween';
import { clamp, damp } from '../core/math';

interface NodeVisual {
  node: KnowledgeNode;
  position: THREE.Vector3;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  label: THREE.Sprite;
  labelMaterial: THREE.SpriteMaterial;
  labelFullText: string;
  labelShortText: string;
  /** Width / height of each label texture variant, used when the sprite is resized. */
  labelFullAspect: number;
  labelShortAspect: number;
  labelFullMap: THREE.Texture;
  labelShortMap: THREE.Texture | null;
  labelShortActive: boolean;
  baseScale: number;
  radius: number;
}

/** A label's laid-out box in CSS pixels, exposed for the layout e2e. */
export interface LabelDebugBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  short: boolean;
  pushed: boolean;
}

function textureAspect(texture: THREE.Texture): number {
  return texture.image instanceof HTMLCanvasElement ? texture.image.width / texture.image.height : 3;
}

const CATEGORY_ORDER: Record<string, number> = {
  Organelles: 0,
  Molecules: 1,
  Processes: 2,
  'Cell types': 3
};

/** World-space height of a node label sprite. */
const LABEL_HEIGHT = 0.3;
/** Labels stay near this CSS-pixel height instead of shrinking with the camera distance. */
const LABEL_TARGET_PX = 19;

export class KnowledgeScene {
  readonly root = new THREE.Group();
  readonly focusOffset = new THREE.Group();
  readonly graph = new THREE.Group();
  readonly nodes = new Map<string, NodeVisual>();

  focused: string | null = null;
  hovered: string | null = null;
  autoRotate = true;
  reducedMotion = false;

  private readonly tweens = new Tweens();
  private readonly vertices = new Map<string, Vec3ish>();
  private readonly edgeList: LayoutEdge[] = [];
  private readonly edges: THREE.LineSegments;
  private readonly edgesMaterial: THREE.ShaderMaterial;
  private focusEdges: THREE.LineSegments | null = null;
  private readonly halo: THREE.Mesh;
  private readonly haloMaterial: THREE.ShaderMaterial;
  private readonly labelWorld = new THREE.Vector3();
  private readonly labelProjection = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private debugLabelBoxes: LabelDebugBox[] = [];
  private language: Language;
  private disposed = false;

  constructor(language: Language = 'en') {
    this.language = language;
    this.root.name = 'knowledge';
    this.root.add(this.focusOffset);
    this.focusOffset.add(this.graph);

    // Deduplicate undirected edges.
    const seen = new Set<string>();
    for (const node of KNOWLEDGE_NODES) {
      for (const link of node.links) {
        const key = [node.id, link].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        this.edgeList.push({ a: node.id, b: link });
      }
    }

    const layout = layout3d(
      KNOWLEDGE_NODES.map((n) => n.id),
      this.edgeList,
      { seed: 17, spread: 4.5 }
    );
    for (const [id, p] of layout) this.vertices.set(id, p);

    // Shared geometry per size bucket keeps the draw-call count sane.
    const geometries = new Map<number, THREE.BufferGeometry>();
    const geoFor = (size: number): THREE.BufferGeometry => {
      const bucket = Math.round(size);
      let geo = geometries.get(bucket);
      if (!geo) {
        geo = new THREE.IcosahedronGeometry(0.1 + bucket * 0.034, 3);
        geometries.set(bucket, geo);
      }
      return geo;
    };

    for (const node of KNOWLEDGE_NODES) {
      const p = layout.get(node.id) ?? { x: 0, y: 0, z: 0 };
      const radius = 0.1 + node.size * 0.034;
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(node.color),
        emissive: new THREE.Color(node.color),
        emissiveIntensity: 0.26,
        roughness: 0.36,
        metalness: 0.28,
        transparent: true,
        opacity: 0.96,
        depthWrite: true
      });
      const mesh = new THREE.Mesh(geoFor(node.size), material);
      mesh.position.set(p.x, p.y, p.z);
      mesh.userData.nodeId = node.id;
      mesh.castShadow = false;
      this.graph.add(mesh);

      const fullText = loc(node.label, this.language);
      const shortText = shortenLabel(fullText);
      const fullMap = labelTexture(fullText, node.color);
      const shortMap = shortText === fullText ? null : labelTexture(shortText, node.color);
      const labelMaterial = new THREE.SpriteMaterial({
        map: fullMap,
        transparent: true,
        depthWrite: false,
        // Labels are an overlay: a node ball in front of a label made the text unreadable.
        depthTest: false,
        opacity: 0.9
      });
      const label = new THREE.Sprite(labelMaterial);
      // Draw after the graph's transparent meshes/edges but before the hands (renderOrder 2), so
      // a node in front of its own text cannot cover it while a hand still occludes it correctly.
      label.renderOrder = 1;
      const fullAspect = textureAspect(fullMap);
      label.scale.set(LABEL_HEIGHT * fullAspect, LABEL_HEIGHT, 1);
      label.position.set(p.x, p.y + radius + 0.16, p.z);
      label.userData.nodeId = node.id;
      this.graph.add(label);

      this.nodes.set(node.id, {
        node,
        position: new THREE.Vector3(p.x, p.y, p.z),
        mesh,
        material,
        label,
        labelMaterial,
        labelFullText: fullText,
        labelShortText: shortText,
        labelFullAspect: fullAspect,
        labelShortAspect: shortMap ? textureAspect(shortMap) : fullAspect,
        labelFullMap: fullMap,
        labelShortMap: shortMap,
        labelShortActive: false,
        baseScale: 1,
        radius
      });
    }

    // Glowing edges with travelling pulses.
    const positions: number[] = [];
    const aT: number[] = [];
    const aOffset: number[] = [];
    const aColor: number[] = [];
    const rng = seeded(421);
    for (const edge of this.edgeList) {
      const a = this.vertices.get(edge.a);
      const b = this.vertices.get(edge.b);
      if (!a || !b) continue;
      const color = new THREE.Color(this.nodes.get(edge.a)?.node.color ?? '#7fd8ff');
      const off = rng();
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      aT.push(0, 1);
      aOffset.push(off, off);
      aColor.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    edgeGeo.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
    edgeGeo.setAttribute('aOffset', new THREE.Float32BufferAttribute(aOffset, 1));
    edgeGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(aColor, 3));

    this.edgesMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aT;
        attribute float aOffset;
        attribute vec3 aColor;
        varying float vT; varying float vOffset; varying vec3 vColor;
        void main() {
          vT = aT; vOffset = aOffset; vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uOpacity;
        varying float vT; varying float vOffset; varying vec3 vColor;
        void main() {
          float p = fract(uTime * 0.19 + vOffset);
          float d = abs(vT - p);
          d = min(d, 1.0 - d);
          float glow = smoothstep(0.11, 0.0, d);
          vec3 col = mix(vColor, vec3(1.0), glow * 0.7);
          float a = (0.1 + glow * 0.62) * uOpacity;
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.edges = new THREE.LineSegments(edgeGeo, this.edgesMaterial);
    this.edges.frustumCulled = false;
    this.graph.add(this.edges);

    this.haloMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color('#ffb347') },
        uIntensity: { value: 1 },
        uTime: { value: 0 }
      },
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
        uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
        varying vec3 vN; varying vec3 vV;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
          float pulse = 0.8 + 0.2 * sin(uTime * 2.0);
          gl_FragColor = vec4(uColor * (1.0 + f * 2.0), f * 0.5 * uIntensity * pulse);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), this.haloMaterial);
    this.halo.visible = false;
    this.graph.add(this.halo);
  }

  pick(raycaster: THREE.Raycaster): string | null {
    const meshes: THREE.Object3D[] = [];
    for (const v of this.nodes.values()) meshes.push(v.mesh);
    // During focus the rest of the graph is far away and dimmed; picking is limited
    // to the focused node's direct neighbours so "related" hops stay deliberate.
    const allowed = this.focused && !this.hovered ? this.neighbours(this.focused) : null;
    const hits = raycaster.intersectObjects(
      allowed ? meshes.filter((m) => allowed.includes(m.userData.nodeId as string)) : meshes,
      false
    );
    for (const hit of hits) {
      const id = hit.object.userData.nodeId as string | undefined;
      if (id) return id;
    }
    return null;
  }

  neighbours(id: string): string[] {
    const node = this.nodes.get(id)?.node;
    if (!node) return [];
    const out = new Set<string>(node.links);
    for (const other of KNOWLEDGE_NODES) if (other.links.includes(id)) out.add(other.id);
    return [...out];
  }

  setLanguage(language: Language): void {
    if (this.language === language) return;
    this.language = language;
    for (const visual of this.nodes.values()) {
      const fullText = loc(visual.node.label, language);
      const shortText = shortenLabel(fullText);
      const fullMap = labelTexture(fullText, visual.node.color);
      const shortMap = shortText === fullText ? null : labelTexture(shortText, visual.node.color);

      const previousFull = visual.labelFullMap;
      const previousShort = visual.labelShortMap;
      visual.labelFullText = fullText;
      visual.labelShortText = shortText;
      visual.labelFullMap = fullMap;
      visual.labelShortMap = shortMap;
      visual.labelFullAspect = textureAspect(fullMap);
      visual.labelShortAspect = shortMap ? textureAspect(shortMap) : visual.labelFullAspect;
      visual.labelShortActive = false;
      visual.labelMaterial.map = fullMap;
      visual.labelMaterial.needsUpdate = true;
      visual.label.scale.set(LABEL_HEIGHT * visual.labelFullAspect, LABEL_HEIGHT, 1);

      previousFull.dispose();
      previousShort?.dispose();
    }
  }

  setHover(id: string | null): void {
    this.hovered = id;
  }

  /** Reduce motion (audit task 3.1): hop the focus camera straight to its destination. */
  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    this.tweens.reducedMotion = value;
    if (value) this.tweens.finishAll();
  }

  focus(id: string): void {
    const visual = this.nodes.get(id);
    if (!visual) return;
    this.focused = id;

    const from = this.focusOffset.position.clone();
    const fromScale = this.graph.scale.x;
    const target = visual.position.clone().multiplyScalar(-2.35);
    this.tweens.add(
      820,
      (t) => {
        this.focusOffset.position.lerpVectors(from, target, t);
        const s = fromScale + (2.35 - fromScale) * t;
        this.graph.scale.setScalar(s);
      },
      ease.inOutCubic
    );

    this.halo.visible = true;
    this.haloMaterial.uniforms.uColor.value.set(visual.node.color);
    this.halo.position.copy(visual.position);
    this.halo.scale.setScalar(visual.radius * 1.9);

    this.rebuildFocusEdges(id);
    this.autoRotate = false;
  }

  unfocus(): void {
    if (!this.focused) return;
    this.focused = null;
    const from = this.focusOffset.position.clone();
    const fromScale = this.graph.scale.x;
    this.tweens.add(
      700,
      (t) => {
        this.focusOffset.position.lerpVectors(from, new THREE.Vector3(), t);
        const s = fromScale + (1 - fromScale) * t;
        this.graph.scale.setScalar(s);
      },
      ease.outCubic
    );
    this.halo.visible = false;
    this.removeFocusEdges();
  }

  private rebuildFocusEdges(id: string): void {
    this.removeFocusEdges();
    const a = this.vertices.get(id);
    if (!a) return;
    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color(this.nodes.get(id)?.node.color ?? '#ffffff');
    for (const nid of this.neighbours(id)) {
      const b = this.vertices.get(nid);
      if (!b) continue;
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      colors.push(color.r, color.g, color.b, 1, 1, 1);
    }
    if (!positions.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.focusEdges = new THREE.LineSegments(geo, mat);
    this.graph.add(this.focusEdges);
  }

  private removeFocusEdges(): void {
    if (!this.focusEdges) return;
    this.graph.remove(this.focusEdges);
    this.focusEdges.geometry.dispose();
    (this.focusEdges.material as THREE.Material).dispose();
    this.focusEdges = null;
  }

  /** World position of a node, accounting for the focus transform. */
  worldPosition(id: string): THREE.Vector3 {
    const v = this.nodes.get(id);
    if (!v) return new THREE.Vector3();
    return v.mesh.getWorldPosition(new THREE.Vector3());
  }

  update(dt: number, elapsed: number, camera?: THREE.PerspectiveCamera): void {
    if (this.disposed) return;
    this.tweens.update(dt * 1000);

    if (this.autoRotate && !this.focused && !this.reducedMotion) this.root.rotation.y += dt * 0.055;
    this.edgesMaterial.uniforms.uTime.value = elapsed;
    this.haloMaterial.uniforms.uTime.value = elapsed;

    const focusedNeighbours = this.focused ? new Set(this.neighbours(this.focused)) : null;

    for (const v of this.nodes.values()) {
      const isFocused = this.focused === v.node.id;
      const isNeighbour = focusedNeighbours?.has(v.node.id) ?? false;
      const targetOpacity = !this.focused ? 1 : isFocused ? 1 : isNeighbour ? 0.72 : 0.12;
      const targetEmissive = !this.focused ? 0.26 : isFocused ? 0.7 : isNeighbour ? 0.4 : 0.1;
      const hoverBoost = this.hovered === v.node.id ? 1.16 : 1;
      const targetScale = (!this.focused ? 1 : isFocused ? 1.55 : isNeighbour ? 1 : 0.86) * hoverBoost;

      v.material.opacity = damp(v.material.opacity, targetOpacity, 7, dt);
      v.material.emissiveIntensity = damp(v.material.emissiveIntensity, targetEmissive, 7, dt);
      const s = damp(v.mesh.scale.x, targetScale, 8, dt);
      v.mesh.scale.setScalar(s);

      const dist = this.cameraDistance(v.mesh);
      const distanceFade = clamp(1.55 - dist / 16, 0.2, 1);
      const labelTarget = !this.focused
        ? distanceFade * (this.hovered === v.node.id ? 1 : 0.9)
        : isFocused
          ? 1
          : isNeighbour
            ? 0.75
            : 0.06;
      v.labelMaterial.opacity = damp(v.labelMaterial.opacity, labelTarget, 6, dt);
      v.label.position.set(v.position.x, v.position.y + v.radius * s + 0.16, v.position.z);
    }

    this.cullLabels(camera);

    if (this.halo.visible) {
      const v = this.focused ? this.nodes.get(this.focused) : null;
      if (v) {
        const pulse = 1 + Math.sin(elapsed * 2.1) * 0.04;
        this.halo.scale.setScalar(v.radius * 1.9 * pulse);
      }
    }
  }

  /**
   * Dense graphs pile constant-size billboard labels on top of each other. The pure layout pass
   * (labelLayout.ts) keeps the labels that matter — hovered, focused, neighbours, then the bigger
   * concepts — pushes lower-priority ones clear of them, and abbreviates every background label
   * once full-size text starts losing too many labels. Boxes are measured in viewport fractions,
   * so the pass is resolution-independent and needs no renderer access.
   */
  private cullLabels(camera?: THREE.PerspectiveCamera): void {
    const visuals = [...this.nodes.values()];
    if (!camera) {
      for (const v of visuals) v.label.visible = true;
      return;
    }

    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const graphScale = this.graph.scale.x;
    const viewAspect = window.innerWidth / Math.max(1, window.innerHeight);
    const neighbours = this.focused ? new Set(this.neighbours(this.focused)) : null;
    const boxes: Array<{
      v: NodeVisual;
      cx: number;
      cy: number;
      wFull: number;
      wShort: number;
      h: number;
      prio: number;
      size: number;
      dist: number;
      legibility: number;
    }> = [];

    for (const v of visuals) {
      if (v.labelMaterial.opacity < 0.08) {
        v.label.visible = false;
        continue;
      }
      v.label.getWorldPosition(this.labelWorld);
      const dist = camera.position.distanceTo(this.labelWorld);
      if (dist < 0.1) {
        v.label.visible = false;
        continue;
      }
      // Keep labels readable on a phone: a sprite at a fixed world height shrinks with the
      // portrait camera pull-back, so compensate up to 2.4x and let the collision pass decide
      // which of the now larger labels can stay.
      const screenPx = ((LABEL_HEIGHT * graphScale) / (2 * dist * tan)) * window.innerHeight;
      const legibility = clamp(LABEL_TARGET_PX / Math.max(1, screenPx), 1, 2.4);
      const activeAspect = v.labelShortActive ? v.labelShortAspect : v.labelFullAspect;
      v.label.scale.set(LABEL_HEIGHT * activeAspect * legibility, LABEL_HEIGHT * legibility, 1);
      // Keep the text just above its node even after the sprite grows; a fixed 0.16 gap would
      // let a legibility-scaled label sink into the node ball.
      v.label.position.set(
        v.position.x,
        v.position.y + v.radius * v.mesh.scale.x + 0.01 + (LABEL_HEIGHT * legibility) / 2,
        v.position.z
      );
      v.label.getWorldPosition(this.labelWorld);
      this.labelProjection.copy(this.labelWorld).project(camera);
      if (this.labelProjection.z < -1 || this.labelProjection.z > 1) {
        v.label.visible = false;
        continue;
      }
      // Full sprite height in clip space at this depth, converted to viewport fractions. The
      // camera's separate x scale means width fractions are height x aspect / viewport aspect.
      const ndcH = (LABEL_HEIGHT * legibility * graphScale) / (dist * tan);
      const h = ndcH * 0.5;
      const prio =
        v.node.id === this.hovered
          ? 0
          : v.node.id === this.focused
            ? 1
            : neighbours?.has(v.node.id)
              ? 2
              : 3;
      boxes.push({
        v,
        cx: this.labelProjection.x * 0.5 + 0.5,
        cy: 0.5 - this.labelProjection.y * 0.5,
        wFull: (h * v.labelFullAspect) / viewAspect,
        wShort: (h * v.labelShortAspect) / viewAspect,
        h,
        prio,
        size: v.node.size,
        dist,
        legibility
      });
    }

    boxes.sort(
      (a, b) =>
        a.prio - b.prio ||
        b.size - a.size ||
        a.dist - b.dist ||
        (a.v.node.id < b.v.node.id ? -1 : 1)
    );

    const layoutBoxes: LabelBox[] = boxes.map((box) => ({
      id: box.v.node.id,
      cx: box.cx,
      cy: box.cy,
      fullWidth: box.wFull,
      shortWidth: box.wShort,
      height: box.h,
      prio: box.prio,
      canShorten: box.v.labelShortMap !== null
    }));
    const layout = layoutLabels(layoutBoxes);

    this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    this.cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
    this.debugLabelBoxes = [];

    for (const box of boxes) {
      const placement = layout.get(box.v.node.id);
      if (!placement || !placement.visible) {
        box.v.label.visible = false;
        this.debugLabelBoxes.push({
          id: box.v.node.id,
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          visible: false,
          short: false,
          pushed: false
        });
        continue;
      }

      const v = box.v;
      this.applyLabelVariant(v, placement.short);
      const aspect = placement.short ? v.labelShortAspect : v.labelFullAspect;
      const width = (box.h * aspect) / viewAspect;
      v.label.visible = true;
      v.label.scale.set(LABEL_HEIGHT * aspect * box.legibility, LABEL_HEIGHT * box.legibility, 1);

      if (placement.dx !== 0 || placement.dy !== 0) {
        const worldPerNdcY = box.dist * tan;
        v.label.getWorldPosition(this.labelWorld);
        this.labelWorld.addScaledVector(
          this.cameraRight,
          placement.dx * 2 * worldPerNdcY * viewAspect
        );
        this.labelWorld.addScaledVector(this.cameraUp, -placement.dy * 2 * worldPerNdcY);
        this.graph.worldToLocal(this.labelWorld);
        v.label.position.copy(this.labelWorld);
      }

      this.debugLabelBoxes.push({
        id: v.node.id,
        x: (box.cx + placement.dx - width / 2) * window.innerWidth,
        y: (box.cy + placement.dy - box.h / 2) * window.innerHeight,
        w: width * window.innerWidth,
        h: box.h * window.innerHeight,
        visible: true,
        short: placement.short,
        pushed: placement.dx !== 0 || placement.dy !== 0
      });
    }
  }

  /** Swap a sprite between its full and abbreviated texture without re-creating the material. */
  private applyLabelVariant(v: NodeVisual, short: boolean): void {
    if (v.labelShortActive === short) return;
    v.labelShortActive = short;
    v.labelMaterial.map = short && v.labelShortMap ? v.labelShortMap : v.labelFullMap;
    v.labelMaterial.needsUpdate = true;
  }

  /** Last laid-out label boxes in CSS pixels (e2e collision audit). */
  labelDebug(): LabelDebugBox[] {
    return this.debugLabelBoxes;
  }

  private cameraDistance(obj: THREE.Object3D): number {
    // Cheap: distance from the graph origin is a good proxy at a fixed camera.
    return obj.position.length() + 8;
  }

  setEdgesVisible(visible: boolean): void {
    this.edges.visible = visible;
  }

  dispose(): void {
    this.disposed = true;
    this.removeFocusEdges();
    // The sprite material references only one texture at a time; dispose both variants here so
    // the inactive map does not leak, then let the traversal release the rest.
    for (const visual of this.nodes.values()) {
      visual.labelFullMap.dispose();
      visual.labelShortMap?.dispose();
      visual.labelMaterial.map = null;
    }
    this.graph.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
      const sprite = obj as THREE.Sprite;
      if (sprite.isSprite) {
        const sm = sprite.material as THREE.SpriteMaterial;
        sm.map?.dispose();
        sm.dispose();
      }
    });
    this.graph.clear();
    this.nodes.clear();
  }
}

interface Vec3ish {
  x: number;
  y: number;
  z: number;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Keep the category ordering referenced so future filters can share it.
export const KNOWLEDGE_CATEGORIES = Object.keys(CATEGORY_ORDER);
