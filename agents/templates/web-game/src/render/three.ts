// 3D renderer: a three.js stage on the game canvas, tuned for phones.
// Only 3D view files import this file, so three.js stays out of a 2D game's
// download. Low-end defaults: device pixel ratio capped at 1.5, antialias
// only on 1x screens, shadows off, cheap Lambert materials, and the pixel
// ratio drops by itself when frames take too long.
//
//   const stage = createStage(canvas, { background: theme.background });
//   stage.scene.add(new Mesh(new SphereGeometry(0.5), new MeshLambertMaterial({ color: theme.p1 })));
//   // resize(size): stage.resize(size)    draw(): stage.render(viewports, [camera])
import {
  CanvasTexture, Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, RepeatWrapping, Scene, Sprite, SpriteMaterial,
  SRGBColorSpace, TextureLoader, WebGLRenderer, type Material, type Mesh, type Object3D, type Texture,
} from "three";
import { followCamera, type Camera, type FollowOptions } from "../game/camera";
import { clamp, type Rect, type Vec } from "../game/collision";
import { cappedDpr, type CanvasSize, type Viewport } from "../game/view";

export type Stage = {
  renderer: WebGLRenderer;
  scene: Scene;
  /** The pixel ratio in use now (after the cap and any automatic drop). */
  pixelRatio(): number;
  resize(size: CanvasSize): void;
  /** Render one camera per viewport (split screen: two). */
  render(viewports: Viewport[], cameras: PerspectiveCamera[]): void;
  /** Frees the renderer and every geometry and material in the scene. */
  dispose(): void;
};

export function createStage(
  canvas: HTMLCanvasElement,
  options: {
    background: string;
    maxDpr?: number;
    fog?: { near: number; far: number };
    /** Real shadow maps. Off by default: they cost a lot on phones. Blob shadows look fine. */
    shadows?: boolean;
  },
): Stage {
  const maxDpr = options.maxDpr ?? 1.5;
  const renderer = new WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance" });
  renderer.shadowMap.enabled = options.shadows ?? false;
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  scene.background = new Color(options.background);
  if (options.fog) scene.fog = new Fog(options.background, options.fog.near, options.fog.far);
  // Sky and ground light plus one sun: enough shape for Lambert materials, no shadow maps.
  scene.add(new HemisphereLight(0xffffff, 0x8a8aa0, 2.0));
  const sun = new DirectionalLight(0xffffff, 1.5);
  sun.position.set(4, 10, 6);
  sun.castShadow = options.shadows ?? false;
  scene.add(sun);

  let size: CanvasSize = { width: 1, height: 1, dpr: 1 };
  let ratio = 1;
  let ceiling = maxDpr;
  const apply = () => {
    renderer.setPixelRatio(ratio);
    renderer.setSize(Math.max(1, size.width), Math.max(1, size.height), false);
  };

  // Steady frame rate: if frames average over 22 ms (under ~45 fps), lower the
  // pixel ratio a step, at most once every 2 s, down to 0.75.
  let last = 0;
  let avg = 16;
  let lastChange = 0;
  const adapt = (now: number) => {
    if (last) avg = avg * 0.95 + Math.min(100, now - last) * 0.05;
    last = now;
    if (now - lastChange < 2000) return;
    if (avg > 22 && ratio > 0.75) {
      ceiling = ratio;
      ratio = Math.max(0.75, ratio - 0.25);
      lastChange = now;
      apply();
    }
  };

  return {
    renderer,
    scene,
    pixelRatio: () => ratio,
    resize(next) {
      size = next;
      ratio = cappedDpr(next.dpr, Math.min(maxDpr, ceiling));
      apply();
    },
    render(viewports, cameras) {
      adapt(performance.now());
      const split = viewports.length > 1;
      renderer.setScissorTest(split);
      viewports.forEach((v, i) => {
        const cam = cameras[i] ?? cameras[0];
        const aspect = v.w / Math.max(1, v.h);
        if (cam.aspect !== aspect) {
          cam.aspect = aspect;
          cam.updateProjectionMatrix();
        }
        // WebGL counts y from the bottom.
        const y = size.height - v.y - v.h;
        renderer.setViewport(v.x, y, v.w, v.h);
        if (split) renderer.setScissor(v.x, y, v.w, v.h);
        renderer.render(scene, cam);
      });
    },
    dispose() {
      disposeTree(scene);
      renderer.dispose();
    },
  };
}

/** Free the geometries and materials under an object (meshes you removed, or the whole scene). */
export function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    mesh.geometry?.dispose();
    const m = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
  });
}

/**
 * A chase camera above and behind a target on the ground. It reuses the kit's
 * 2D follow camera (`ground`, in world units) for smoothing and look-ahead,
 * then places the 3D camera. `scale` converts world units to 3D units.
 */
export function chaseCamera(
  cam: PerspectiveCamera,
  ground: Camera,
  target: Vec,
  dt: number,
  o: Pick<FollowOptions, "velocity" | "lookAhead" | "stiffness"> & {
    scale: number;
    height?: number;
    back?: number;
    /** Keep the point the camera looks at inside this area (world units), so the view stays on the arena. */
    bounds?: Rect;
  },
): void {
  followCamera(ground, target, dt, { velocity: o.velocity, lookAhead: o.lookAhead, stiffness: o.stiffness });
  if (o.bounds) {
    ground.x = clamp(ground.x, o.bounds.x, o.bounds.x + o.bounds.w);
    ground.y = clamp(ground.y, o.bounds.y, o.bounds.y + o.bounds.h);
  }
  const x = ground.x * o.scale;
  const z = ground.y * o.scale;
  cam.position.set(x, o.height ?? 10, z + (o.back ?? 7));
  cam.lookAt(x, 0, z);
}

const textures = new Map<string, Texture>();

/** A texture from an image URL (an art slot or a file in public/), loaded once. */
export function loadTexture(url: string): Texture {
  let t = textures.get(url);
  if (!t) {
    t = new TextureLoader().load(url);
    t.colorSpace = SRGBColorSpace;
    textures.set(url, t);
  }
  return t;
}

/**
 * A flat image that always faces the camera (a billboard), `size` 3D units
 * tall, standing on its lower edge. Use it to draw 2D art in a 3D game.
 */
export function billboard(url: string, size: number): Sprite {
  const map = loadTexture(url);
  const s = new Sprite(new SpriteMaterial({ map, transparent: true }));
  s.center.set(0.5, 0);
  s.scale.set(size, size, 1);
  const fit = () => {
    const img = map.image as { width?: number; height?: number } | undefined;
    if (img?.width && img.height) s.scale.set((size * img.width) / img.height, size, 1);
  };
  if ((map.image as { complete?: boolean } | undefined)?.complete) fit();
  else (map.image as HTMLImageElement | undefined)?.addEventListener?.("load", fit, { once: true });
  return s;
}

/** A soft checker texture for floors, drawn once in a small canvas. `repeat` = tiles across the floor. */
export function checkerTexture(a: string, b: string, repeat: [number, number]): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = b;
  g.beginPath();
  g.roundRect(3, 3, 26, 26, 6);
  g.roundRect(35, 35, 26, 26, 6);
  g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat[0] / 2, repeat[1] / 2);
  t.anisotropy = 4;
  return t;
}
