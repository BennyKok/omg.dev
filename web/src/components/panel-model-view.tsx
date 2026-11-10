// A 3D model (glb) in an agent's status: turn it with a finger or the mouse.
//
// Loaded on demand (React.lazy) so three.js is its own chunk and costs the
// app nothing until a status carries a model. The bytes come through the
// app's transport like any artifact; nothing is fetched from elsewhere.
import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { omgFetch } from "@/lib/omg-client";

const HEIGHT = 240;

function frame(camera: PerspectiveCamera, controls: OrbitControls, object: Object3D): void {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const radius = Math.max(size.x, size.y, size.z) || 1;
  const distance = radius / (2 * Math.tan((camera.fov * Math.PI) / 360)) * 1.6;
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.position.copy(center).add(new Vector3(distance * 0.6, distance * 0.4, distance));
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

export default function PanelModelView({ url, label }: { url: string; label: string }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setState("error");
      return;
    }
    const width = el.clientWidth || 300;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, HEIGHT);
    el.appendChild(renderer.domElement);
    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 0.6));
    scene.add(new HemisphereLight(0xffffff, 0x444444, 1.2));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    const camera = new PerspectiveCamera(40, width / HEIGHT, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    // The pane scrolls; a wheel over the model should not zoom it away.
    controls.enableZoom = false;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
    });
    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    const resize = new ResizeObserver(() => {
      const w = el.clientWidth || width;
      renderer.setSize(w, HEIGHT);
      camera.aspect = w / HEIGHT;
      camera.updateProjectionMatrix();
    });
    resize.observe(el);

    void (async () => {
      try {
        const res = await omgFetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const bytes = await res.arrayBuffer();
        const gltf = await new GLTFLoader().parseAsync(bytes, "");
        if (disposed) return;
        scene.add(gltf.scene);
        frame(camera, controls, gltf.scene);
        setState("ready");
        loop();
      } catch {
        if (!disposed) setState("error");
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-border/60 bg-muted/30" style={{ height: HEIGHT }}>
      <div ref={host} role="img" aria-label={label} className="size-full touch-none" />
      {state !== "ready" ? (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
          {state === "loading" ? "Loading 3D model…" : "Could not show this 3D model"}
        </div>
      ) : null}
    </div>
  );
}
