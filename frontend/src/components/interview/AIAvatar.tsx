import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

import type { AvatarState } from "@/hooks/useInterviewState";
import { easeEditorial, durations } from "@/lib/motion";

interface Props {
  state: AvatarState;
  /** 0..1 amplitude of the AI's TTS output. Drives vertex displacement when speaking. */
  amplitude: number;
  /** CSS pixel size — three.js renderer matches. */
  size?: number;
  className?: string;
}

const COLORS = {
  ink: 0x1a1814,
  inkMuted: 0x8a8478,
  accent: 0xe8472c,
};

/**
 * 3D audio-reactive orb for the AI interviewer.
 *
 * - Lazy-loads three.js so unrelated routes don't pay the bundle cost.
 * - Falls back to an SVG ring if WebGL is unavailable.
 * - Vertex displacement is driven by `amplitude` while speaking, by a sine
 *   while thinking, and is near-flat when idle.
 * - State transitions (color, scale) animate via three.js per-frame.
 *
 * No external state — all behavior derives from the `state` and `amplitude`
 * props, which the parent feeds from `useInterviewState` and the audio player.
 */
export function AIAvatar({ state, amplitude, size = 200, className }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const ampRef = useRef(amplitude);
  const [webglFailed, setWebglFailed] = useState(false);

  // Keep refs in sync without re-mounting the WebGL context.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    ampRef.current = amplitude;
  }, [amplitude]);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let renderer: import("three").WebGLRenderer | null = null;
    let scene: import("three").Scene | null = null;
    let camera: import("three").PerspectiveCamera | null = null;
    let mesh: import("three").Mesh | null = null;
    let material: import("three").MeshBasicMaterial | null = null;
    let geometry: import("three").IcosahedronGeometry | null = null;
    let basePositions: Float32Array | null = null;

    (async () => {
      try {
        const THREE = await import("three");
        if (cancelled || !mountRef.current) return;

        // Quick WebGL probe.
        const probe = document.createElement("canvas");
        if (
          !probe.getContext("webgl") &&
          !probe.getContext("experimental-webgl")
        ) {
          setWebglFailed(true);
          return;
        }

        const mount = mountRef.current;
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        camera.position.z = 3.2;

        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "low-power",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(size, size, false);
        renderer.setClearColor(0x000000, 0);
        mount.appendChild(renderer.domElement);

        // Detail 4 → 642 vertices. Plenty for smooth wobble, light on CPU.
        geometry = new THREE.IcosahedronGeometry(1, 4);
        basePositions = (
          geometry.attributes.position.array as Float32Array
        ).slice();

        material = new THREE.MeshBasicMaterial({
          color: COLORS.ink,
          wireframe: true,
          transparent: true,
          opacity: 0.85,
        });

        mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        // A subtle solid inner sphere so the wireframe reads against the canvas.
        const inner = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.86, 2),
          new THREE.MeshBasicMaterial({
            color: 0xfbf8f2,
            transparent: true,
            opacity: 0.55,
          }),
        );
        scene.add(inner);

        const start = performance.now();
        const animate = () => {
          raf = requestAnimationFrame(animate);
          if (!mesh || !geometry || !basePositions || !material) return;

          const t = (performance.now() - start) / 1000;
          const s = stateRef.current;
          const amp = ampRef.current;

          // Rotation — calmer when idle, livelier when active.
          const rot =
            s === "speaking" ? 0.18 : s === "thinking" ? 0.12 : s === "ended" ? 0.04 : 0.06;
          mesh.rotation.y += rot * 0.016;
          mesh.rotation.x = Math.sin(t * 0.4) * 0.18;
          inner.rotation.y -= rot * 0.012;

          // Color blend.
          const target =
            s === "speaking" || s === "thinking"
              ? COLORS.accent
              : s === "ended"
                ? COLORS.inkMuted
                : COLORS.ink;
          (material.color as import("three").Color).lerp(
            new THREE.Color(target),
            0.08,
          );

          // Per-state displacement intensity.
          const displaceAmt =
            s === "speaking"
              ? 0.06 + Math.min(1, amp) * 0.55
              : s === "thinking"
                ? 0.06 + Math.sin(t * 2.2) * 0.05
                : s === "ended"
                  ? 0.02
                  : 0.04 + Math.sin(t * 0.9) * 0.02;

          const positions = geometry.attributes.position
            .array as Float32Array;
          for (let i = 0; i < positions.length; i += 3) {
            const bx = basePositions[i];
            const by = basePositions[i + 1];
            const bz = basePositions[i + 2];
            const wave =
              Math.sin(t * 1.4 + bx * 4) *
              Math.cos(t * 1.1 + by * 4) *
              Math.sin(t * 0.9 + bz * 4);
            const factor = 1 + wave * displaceAmt;
            positions[i] = bx * factor;
            positions[i + 1] = by * factor;
            positions[i + 2] = bz * factor;
          }
          geometry.attributes.position.needsUpdate = true;

          // Outer scale pulse — additive on top of vertex displacement.
          const outerScale =
            s === "speaking"
              ? 1 + Math.min(1, amp) * 0.12
              : s === "thinking"
                ? 1 + Math.sin(t * 2.5) * 0.04
                : 1;
          mesh.scale.setScalar(outerScale);

          renderer!.render(scene!, camera!);
        };
        animate();
      } catch (err) {
        console.warn("AIAvatar three.js init failed:", err);
        setWebglFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      try {
        if (geometry) geometry.dispose();
        if (material) material.dispose();
        scene?.traverse((obj) => {
          const m = obj as import("three").Mesh;
          if (m.isMesh) {
            m.geometry?.dispose?.();
            const mat = m.material as import("three").Material;
            mat?.dispose?.();
          }
        });
        if (renderer) {
          if (
            mountRef.current &&
            renderer.domElement.parentNode === mountRef.current
          ) {
            mountRef.current.removeChild(renderer.domElement);
          }
          renderer.dispose();
        }
      } catch {
        /* ignore teardown errors */
      }
    };
  }, [size]);

  return (
    <motion.div
      className={className}
      style={{ width: size, height: size, position: "relative" }}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: durations.slow, ease: easeEditorial }}
      role="img"
      aria-label={
        state === "speaking"
          ? "AI is speaking"
          : state === "thinking"
            ? "AI is thinking"
            : state === "ended"
              ? "Session ended"
              : "AI is listening"
      }
    >
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} aria-hidden="true" />
      {webglFailed && <FallbackOrb state={state} amplitude={amplitude} />}
    </motion.div>
  );
}

/**
 * SVG fallback used when WebGL isn't available. It mirrors the orb's three
 * states with simple framer-motion animations so the UX never silently
 * degrades to a blank panel.
 */
function FallbackOrb({
  state,
  amplitude,
}: {
  state: AvatarState;
  amplitude: number;
}) {
  const ringScale =
    state === "speaking"
      ? 1 + Math.min(1, amplitude) * 0.12
      : state === "thinking"
        ? 1.04
        : 1;
  const tint =
    state === "speaking" || state === "thinking"
      ? "var(--accent)"
      : state === "ended"
        ? "var(--ink-muted)"
        : "var(--ink)";

  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <motion.circle
        cx="50"
        cy="50"
        r="34"
        fill="none"
        stroke={tint}
        strokeWidth="0.6"
        animate={{ scale: ringScale }}
        style={{ transformOrigin: "50% 50%" }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      />
      <motion.circle
        cx="50"
        cy="50"
        r="22"
        fill="none"
        stroke={tint}
        strokeOpacity={0.5}
        strokeWidth="0.5"
        animate={{
          scale:
            state === "thinking" ? [1, 1.08, 1] : state === "speaking" ? 1 + amplitude * 0.18 : 1,
        }}
        style={{ transformOrigin: "50% 50%" }}
        transition={{
          duration: state === "thinking" ? 1.4 : 0.2,
          repeat: state === "thinking" ? Infinity : 0,
          ease: "easeInOut",
        }}
      />
    </svg>
  );
}
