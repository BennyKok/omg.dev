// Coin Dash, 3D view: the same game as view-2d.ts, drawn with three.js.
// The rules are in logic.ts and do not change. Game x/y become 3D x/z on the
// floor; SCALE turns world units into 3D units. Each object uses its image
// from src/app/art.ts as a camera-facing sprite when there is one, and simple
// shapes in the theme colours when there is not. Keep createView's shape
// (src/game/view.ts). three.js loads only when this file is the active view.
import {
  BoxGeometry, CircleGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera,
  PlaneGeometry, SphereGeometry, type Object3D,
} from "three";
import { ART } from "../../app/art";
import { createCamera } from "../../game/camera";
import type { PlayerId } from "../../game/input";
import { splitViewports, type CanvasSize, type GameView, type ViewOptions } from "../../game/view";
import { billboard, chaseCamera, checkerTexture, createStage } from "../../render/three";
import { theme } from "../../ui/theme";
import { isDashing, WORLD, type Game } from "./logic";

const SCALE = 1 / 40; // 600 x 900 world units -> 15 x 22.5 floor

export function createView(canvas: HTMLCanvasElement, { colors }: ViewOptions): GameView<Game> {
  const stage = createStage(canvas, { background: theme.background, fog: { near: 22, far: 48 } });
  const { scene } = stage;
  const W = WORLD.w * SCALE;
  const H = WORLD.h * SCALE;

  // The arena: a tiled floor and four low walls.
  const floor = new Mesh(new PlaneGeometry(W, H), new MeshLambertMaterial({ map: checkerTexture(theme.world, theme.worldDetail, [W / 1.5, H / 1.5]) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(W / 2, 0, H / 2);
  scene.add(floor);
  const wallMat = new MeshLambertMaterial({ color: theme.worldEdge });
  const T = 0.45; // wall thickness
  for (const [w, d, x, z] of [[W + T * 2, T, W / 2, -T / 2], [W + T * 2, T, W / 2, H + T / 2], [T, H, -T / 2, H / 2], [T, H, W + T / 2, H / 2]]) {
    const wall = new Mesh(new BoxGeometry(w, 0.5, d), wallMat);
    wall.position.set(x, 0.25, z);
    scene.add(wall);
  }

  // Shared shapes and materials. One object per game object, reused between frames.
  const coinGeo = new CylinderGeometry(1, 1, 0.28, 24);
  const coinMat = new MeshLambertMaterial({ color: theme.coin, emissive: theme.coin, emissiveIntensity: 0.25 });
  const blobGeo = new SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 1.7);
  const blobMat = new MeshLambertMaterial({ color: theme.hazard });
  const eyeGeo = new SphereGeometry(1, 12, 8);
  const eyeMat = new MeshBasicMaterial({ color: "#2a1f45" });
  const whiteMat = new MeshLambertMaterial({ color: "#ffffff" });
  const bodyGeo = new SphereGeometry(1, 28, 20);
  const shadowGeo = new CircleGeometry(1, 24);
  const shadowMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false });
  const playerMats: Record<PlayerId, MeshLambertMaterial> = {
    p1: new MeshLambertMaterial({ color: colors.p1 }),
    p2: new MeshLambertMaterial({ color: colors.p2 }),
  };

  const eye = (x: number, y: number, z: number, r: number, mat = eyeMat) => {
    const m = new Mesh(eyeGeo, mat);
    m.position.set(x, y, z);
    m.scale.set(r, r * 1.5, r * 0.6);
    return m;
  };
  /** The art slot image as a billboard, or the placeholder made by `shape`. Sizes are in object radii. */
  const art = (key: string, height: number, shape: () => Object3D): Object3D => {
    const src = ART.sprites[key];
    if (!src) return shape();
    const g = new Group();
    g.add(billboard(src, height));
    return g;
  };
  const makeCoin = () => art("coin", 2.2, () => {
    const face = new Mesh(coinGeo, coinMat);
    face.rotation.x = Math.PI / 2;
    const g = new Group();
    g.add(face);
    return g;
  });
  const makeBlob = () => art("hazard", 2, () => {
    const g = new Group();
    const body = new Mesh(blobGeo, blobMat);
    body.scale.set(1.2, 1.1, 1.2);
    g.add(body, eye(-0.35, 0.55, 0.95, 0.12), eye(0.35, 0.55, 0.95, 0.12));
    return g;
  });
  const makeRunner = (id: PlayerId) => art("player", 2.4, () => {
    const g = new Group();
    const body = new Mesh(bodyGeo, playerMats[id]);
    body.position.y = 1;
    const face = new Mesh(eyeGeo, whiteMat);
    face.position.set(0, 1.1, 0.72);
    face.scale.set(0.55, 0.45, 0.35);
    g.add(body, face, eye(-0.2, 1.12, 0.98, 0.09), eye(0.2, 1.12, 0.98, 0.09));
    return g;
  });

  type Thing = { body: Object3D; shadow: Mesh };
  const withShadow = (body: Object3D): Thing => {
    const shadow = new Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    scene.add(body, shadow);
    return { body, shadow };
  };
  const coins = new Map<number, Thing>();
  const hazards: Thing[] = [];
  const players: Thing[] = [];
  const place = (o: Thing, x: number, y: number, r: number, lift: number) => {
    o.body.position.set(x * SCALE, lift, y * SCALE);
    o.shadow.position.set(x * SCALE, 0.02, y * SCALE);
    o.shadow.scale.setScalar(r * SCALE * 1.1);
  };

  const cams: Record<PlayerId, PerspectiveCamera> = { p1: new PerspectiveCamera(50, 1, 0.1, 100), p2: new PerspectiveCamera(50, 1, 0.1, 100) };
  const ground = { p1: createCamera(WORLD.w / 2, WORLD.h / 2), p2: createCamera(WORLD.w / 2, WORLD.h / 2) };
  let size: CanvasSize = { width: 1, height: 1, dpr: 1 };

  return {
    resize(next) {
      size = next;
      stage.resize(next);
    },
    update(game, dt) {
      const views = splitViewports(size, game.players.length);
      const tall = views[0].h / Math.max(1, views[0].w);
      for (const p of game.players) {
        // Taller views (a phone held upright) sit the camera higher to see more floor.
        chaseCamera(cams[p.id], ground[p.id], p, dt, {
          velocity: { x: p.vx, y: p.vy }, lookAhead: 0.35, scale: SCALE, height: 13 + tall * 4, back: 6 + tall * 2,
          // The camera sits behind (+y), so stop earlier at the near edge than at the far one.
          bounds: { x: 200, y: 120, w: WORLD.w - 400, h: WORLD.h - 420 },
        });
      }
    },
    draw(game) {
      const t = game.time;
      // Coins: add new ones, remove collected ones, spin all.
      const seen = new Set<number>();
      for (const c of game.coins) {
        seen.add(c.id);
        let o = coins.get(c.id);
        if (!o) {
          o = withShadow(makeCoin());
          o.body.scale.setScalar(c.r * SCALE);
          coins.set(c.id, o);
        }
        place(o, c.x, c.y, c.r, c.r * SCALE + 0.2 + Math.sin(t * 3 + c.id) * 0.08);
        o.body.rotation.y = t * 2.2 + c.id;
      }
      for (const [id, o] of coins) {
        if (!seen.has(id)) {
          scene.remove(o.body, o.shadow);
          coins.delete(id);
        }
      }
      game.hazards.forEach((h, i) => {
        const o = (hazards[i] ??= withShadow(makeBlob()));
        const squash = 1 + Math.sin(t * 6 + i) * 0.06;
        o.body.scale.set(h.r * SCALE * squash, (h.r * SCALE) / squash, h.r * SCALE * squash);
        place(o, h.x, h.y, h.r * 1.2, 0);
        // Blobs face the camera, so their eyes always show.
        o.body.rotation.y = Math.sin(t * 2 + i) * 0.3;
      });
      game.players.forEach((p, i) => {
        const o = (players[i] ??= withShadow(makeRunner(p.id)));
        o.body.scale.setScalar(p.r * SCALE);
        const hop = Math.abs(Math.sin(t * 14)) * 0.12 * Math.min(1, Math.hypot(p.vx, p.vy) / 100);
        place(o, p.x, p.y, p.r, hop);
        o.body.rotation.y = Math.atan2(p.fx, p.fy);
        o.body.scale.z = p.r * SCALE * (isDashing(game, p) ? 1.25 : 1);
        const blink = t < p.hurtUntil && Math.floor(t * 12) % 2 === 1;
        o.body.visible = !blink && p.lives > 0;
        o.shadow.visible = p.lives > 0;
      });
      stage.render(splitViewports(size, game.players.length), game.players.map((p) => cams[p.id]));
    },
    dispose() {
      stage.dispose();
    },
  };
}
