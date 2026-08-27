"use client";

import Image from "next/image";
import { useEffect, useRef, type CSSProperties } from "react";
import * as THREE from "three";

const NODES = [
  { label: "求人", angle: -156, distance: 42 },
  { label: "企業研究", angle: -112, distance: 43 },
  { label: "ES", angle: -66, distance: 42 },
  { label: "応募管理", angle: -24, distance: 43 },
  { label: "フィードバック", angle: 20, distance: 44 },
  { label: "スケジュール", angle: 66, distance: 43 },
  { label: "自己分析", angle: 111, distance: 44 },
  { label: "面接", angle: 154, distance: 43 },
] as const;

export function PrizgramUniverse() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 20);
    camera.position.z = 5.2;

    const group = new THREE.Group();
    scene.add(group);

    const particleCount = 460;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i += 1) {
      const radius = 1.15 + Math.random() * 1.75;
      const theta = Math.random() * Math.PI * 2;
      const wave = (Math.random() - 0.5) * 1.35;
      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.sin(theta) * radius * 0.72;
      positions[i * 3 + 2] = wave;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    const particleMaterial = new THREE.PointsMaterial({
      color: 0x5bd9a6,
      size: 0.025,
      transparent: true,
      opacity: 0.62,
      sizeAttenuation: true,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    group.add(particles);

    const ringMaterial = new THREE.LineBasicMaterial({
      color: 0x087a55,
      transparent: true,
      opacity: 0.3,
    });
    const ringGeometries: THREE.BufferGeometry[] = [];
    [1.05, 1.82, 2.5].forEach((radius, index) => {
      const curve = new THREE.EllipseCurve(
        0,
        0,
        radius,
        radius * 0.72,
        0,
        Math.PI * 2,
      );
      const ringGeometry = new THREE.BufferGeometry().setFromPoints(
        curve
          .getPoints(128)
          .map((point) => new THREE.Vector3(point.x, point.y, 0)),
      );
      ringGeometries.push(ringGeometry);
      const ring = new THREE.LineLoop(ringGeometry, ringMaterial);
      ring.rotation.x = index === 1 ? 0.3 : -0.12;
      ring.rotation.y = index === 2 ? 0.26 : -0.08;
      group.add(ring);
    });

    const spokes: THREE.Vector3[] = [];
    NODES.forEach(({ angle }) => {
      const radians = (angle * Math.PI) / 180;
      spokes.push(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(Math.cos(radians) * 2.5, Math.sin(radians) * 1.8, 0),
      );
    });
    const spokeGeometry = new THREE.BufferGeometry().setFromPoints(spokes);
    const spokeMaterial = new THREE.LineBasicMaterial({
      color: 0x087a55,
      transparent: true,
      opacity: 0.2,
    });
    const spokeLines = new THREE.LineSegments(spokeGeometry, spokeMaterial);
    group.add(spokeLines);

    const pointer = new THREE.Vector2();
    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * -2;
    };
    host.addEventListener("pointermove", onPointerMove);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      renderer.setSize(
        Math.max(1, rect.width),
        Math.max(1, rect.height),
        false,
      );
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const clock = new THREE.Clock();
    let frame = 0;
    const render = () => {
      const elapsed = clock.getElapsedTime();
      if (!reduced) {
        group.rotation.z = elapsed * 0.025;
        group.rotation.x += (pointer.y * 0.08 - group.rotation.x) * 0.035;
        group.rotation.y += (pointer.x * 0.11 - group.rotation.y) * 0.035;
        particles.rotation.z = -elapsed * 0.045;
        particles.position.z = Math.sin(elapsed * 0.55) * 0.12;
      }
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      particleGeometry.dispose();
      particleMaterial.dispose();
      ringGeometries.forEach((geometry) => geometry.dispose());
      ringMaterial.dispose();
      spokeGeometry.dispose();
      spokeMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      className="lp-universe"
      ref={hostRef}
      aria-label="Prizgramが就活情報をひとつの文脈につなぐ図"
    >
      <canvas
        ref={canvasRef}
        className="lp-universe-canvas"
        aria-hidden="true"
      />
      <div className="lp-universe-center">
        <Image
          src="/brand/prizgram-icon.svg"
          alt="Prizgram"
          width={1254}
          height={1254}
          className="lp-universe-logo"
        />
        <span>YOUR CAREER CONTEXT</span>
      </div>
      <div className="lp-universe-orbit" aria-hidden="true">
        {NODES.map((node, index) => (
          <span
            className="lp-universe-node"
            key={node.label}
            style={
              {
                "--node-angle": `${node.angle}deg`,
                "--node-distance": `${node.distance}%`,
                "--node-delay": `${index * -0.32}s`,
              } as CSSProperties
            }
          >
            {node.label}
          </span>
        ))}
      </div>
      <p className="lp-universe-hint">MOVE TO EXPLORE · LIVE CONTEXT MAP</p>
    </div>
  );
}
