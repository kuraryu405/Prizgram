"use client";

/* eslint-disable react-hooks/refs -- Three.js uniforms are intentionally mutable and updated outside React's render cycle. */

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import type { MotionValue } from "motion/react";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { InstancedMesh, Points } from "three";
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import {
  createParticleTargets,
  createSeededRandom,
  MAX_PARTICLE_COUNT,
  sceneQualityConfig,
  stepSceneQuality,
  type SceneQuality,
} from "./landing-scene-model";

type LandingThreeSceneProps = {
  active: boolean;
  introProgress: MotionValue<number>;
  onQualityChange: (quality: SceneQuality) => void;
  onReady: () => void;
  pointerX: MotionValue<number>;
  pointerY: MotionValue<number>;
  quality: SceneQuality;
  storyProgress: MotionValue<number>;
};

type SceneMotionProps = Pick<
  LandingThreeSceneProps,
  "introProgress" | "pointerX" | "pointerY" | "storyProgress"
>;

const particleVertexShader = /* glsl */ `
  uniform float uIntro;
  uniform float uPointScale;
  uniform float uProgress;
  uniform float uTime;
  uniform vec2 uPointer;

  attribute vec3 aCloud;
  attribute vec3 aColor;
  attribute vec3 aDiscovery;
  attribute vec3 aLearning;
  attribute vec3 aLogo;
  attribute vec3 aPersona;
  attribute vec3 aScoring;
  attribute float aSeed;

  varying vec3 vColor;
  varying float vEnergy;
  varying float vLogoLock;

  float easeOutCubic(float value) {
    float inverted = 1.0 - value;
    return 1.0 - inverted * inverted * inverted;
  }

  float transitionEnergy(float start, float end, float value) {
    float phase = smoothstep(start, end, value);
    return 4.0 * phase * (1.0 - phase);
  }

  void main() {
    float personaMix = smoothstep(0.08, 0.29, uProgress);
    float discoveryMix = smoothstep(0.29, 0.51, uProgress);
    float scoringMix = smoothstep(0.51, 0.73, uProgress);
    float learningMix = smoothstep(0.73, 0.96, uProgress);

    vec3 narrative = mix(aLogo, aPersona, personaMix);
    narrative = mix(narrative, aDiscovery, discoveryMix);
    narrative = mix(narrative, aScoring, scoringMix);
    narrative = mix(narrative, aLearning, learningMix);

    float intro = easeOutCubic(clamp(uIntro, 0.0, 1.0));
    vec3 transformed = mix(aCloud, narrative, intro);
    float energy =
      transitionEnergy(0.08, 0.29, uProgress) +
      transitionEnergy(0.29, 0.51, uProgress) +
      transitionEnergy(0.51, 0.73, uProgress) +
      transitionEnergy(0.73, 0.96, uProgress);
    energy = min(1.0, energy);

    float phase = aSeed * 31.4159 + uTime * (0.28 + aSeed * 0.22);
    vec3 turbulence = vec3(
      sin(phase + transformed.y * 1.8),
      cos(phase * 0.83 + transformed.x * 1.45),
      sin(phase * 1.17 + transformed.x - transformed.y)
    );
    transformed += turbulence * (0.035 + energy * 0.18) * intro;
    transformed.x += uPointer.x * (0.08 + abs(transformed.z) * 0.025);
    transformed.y += uPointer.y * (0.08 + abs(transformed.z) * 0.025);

    float orbit = uProgress * 0.16 + uPointer.x * 0.035;
    float orbitCos = cos(orbit);
    float orbitSin = sin(orbit);
    transformed.xz = mat2(orbitCos, -orbitSin, orbitSin, orbitCos) * transformed.xz;

    vec4 modelPosition = modelMatrix * vec4(transformed, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = uPointScale * (0.72 + aSeed * 0.85) * (7.5 / max(2.2, -viewPosition.z));

    vColor = aColor;
    vEnergy = energy;
    vLogoLock = smoothstep(0.82, 1.0, uIntro) * max(
      1.0 - smoothstep(0.08, 0.16, uProgress),
      smoothstep(0.88, 0.98, uProgress)
    );
  }
`;

const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vEnergy;
  varying float vLogoLock;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distanceToCenter = length(centered);
    float alpha = 1.0 - smoothstep(0.18, 0.5, distanceToCenter);
    float core = 1.0 - smoothstep(0.0, 0.16, distanceToCenter);
    vec3 color = mix(vColor, vec3(0.98, 0.95, 0.64), core * (0.2 + vEnergy * 0.35));
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(color, alpha * (0.58 + core * 0.34) * (1.0 - vLogoLock));
  }
`;

const logoVertexShader = /* glsl */ `
  uniform float uProgress;
  uniform float uTime;
  uniform vec2 uPointer;

  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vec3 transformed = position;
    transformed.z += sin(position.x * 1.9 + uTime * 0.45) * 0.018;
    transformed.x += uPointer.x * 0.06;
    transformed.y += uPointer.y * 0.06;
    vNormal = normalize(normalMatrix * normal);
    vPosition = transformed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

const logoFragmentShader = /* glsl */ `
  uniform float uIntro;
  uniform float uProgress;

  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    float early = 1.0 - smoothstep(0.1, 0.29, uProgress);
    float late = smoothstep(0.77, 0.96, uProgress);
    float reveal = smoothstep(0.68, 1.0, uIntro);
    float logoLock = smoothstep(0.82, 1.0, uIntro) * max(
      1.0 - smoothstep(0.08, 0.16, uProgress),
      smoothstep(0.88, 0.98, uProgress)
    );
    float opacity = max(early, late * 0.92) * reveal * (1.0 - logoLock);
    if (opacity < 0.01) discard;

    float vertical = smoothstep(-2.6, 2.6, vPosition.y);
    float horizontal = smoothstep(-3.0, 3.0, vPosition.x);
    vec3 deep = vec3(0.008, 0.255, 0.21);
    vec3 mint = vec3(0.31, 0.75, 0.64);
    vec3 gold = vec3(0.98, 0.95, 0.64);
    vec3 gradient = mix(deep, mint, vertical);
    gradient = mix(gradient, gold, horizontal * vertical * 0.34);
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.2);
    vec3 color = gradient + fresnel * vec3(0.25, 0.48, 0.37);
    gl_FragColor = vec4(color, opacity * (0.72 + fresnel * 0.24));
  }
`;

function buildLogoGeometry(
  data: ReturnType<SVGLoader["parse"]>,
): BufferGeometry {
  const geometries: BufferGeometry[] = [];

  for (const path of data.paths) {
    for (const shape of path.toShapes()) {
      geometries.push(
        new ExtrudeGeometry(shape, {
          bevelEnabled: true,
          bevelSegments: 2,
          bevelSize: 2.2,
          bevelThickness: 2.2,
          curveSegments: 4,
          depth: 15,
          steps: 1,
        }),
      );
    }
  }

  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error("Prizgram logo geometry could not be created");

  merged.computeBoundingBox();
  const bounds = merged.boundingBox;
  if (!bounds) throw new Error("Prizgram logo bounds are unavailable");

  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const scale = 5.7 / Math.max(size.x, size.y);
  merged.translate(-center.x, -center.y, -center.z);
  merged.scale(scale, -scale, scale);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

function sampleLogoPositions(geometry: BufferGeometry): Float32Array {
  const random = createSeededRandom(279_2026);
  const mesh = new Mesh(geometry);
  const sampler = new MeshSurfaceSampler(mesh) as MeshSurfaceSampler & {
    setRandomGenerator: (generator: () => number) => MeshSurfaceSampler;
  };
  sampler.setRandomGenerator(random).build();
  const point = new Vector3();
  const positions = new Float32Array(MAX_PARTICLE_COUNT * 3);

  for (let index = 0; index < MAX_PARTICLE_COUNT; index += 1) {
    sampler.sample(point);
    const offset = index * 3;
    positions[offset] = point.x;
    positions[offset + 1] = point.y;
    positions[offset + 2] = point.z;
  }
  return positions;
}

function ParticleField({
  introProgress,
  logoGeometry,
  pointerX,
  pointerY,
  quality,
  storyProgress,
}: SceneMotionProps & {
  logoGeometry: BufferGeometry;
  quality: SceneQuality;
}) {
  const pointsRef = useRef<Points>(null);
  const uniformsRef = useRef({
    uIntro: { value: 0 },
    uPointScale: { value: 8 },
    uPointer: { value: new Vector2() },
    uProgress: { value: 0 },
    uTime: { value: 0 },
  });
  const geometry = useMemo(() => {
    const logoPositions = sampleLogoPositions(logoGeometry);
    const targets = createParticleTargets(logoPositions);
    const result = new BufferGeometry();
    result.setAttribute(
      "position",
      new Float32BufferAttribute(targets.logo, 3),
    );
    result.setAttribute("aCloud", new Float32BufferAttribute(targets.cloud, 3));
    result.setAttribute("aLogo", new Float32BufferAttribute(targets.logo, 3));
    result.setAttribute(
      "aPersona",
      new Float32BufferAttribute(targets.persona, 3),
    );
    result.setAttribute(
      "aDiscovery",
      new Float32BufferAttribute(targets.discovery, 3),
    );
    result.setAttribute(
      "aScoring",
      new Float32BufferAttribute(targets.scoring, 3),
    );
    result.setAttribute(
      "aLearning",
      new Float32BufferAttribute(targets.learning, 3),
    );
    result.setAttribute(
      "aColor",
      new Float32BufferAttribute(targets.colors, 3),
    );
    result.setAttribute("aSeed", new Float32BufferAttribute(targets.seeds, 1));
    result.computeBoundingSphere();
    return result;
  }, [logoGeometry]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        blending: NormalBlending,
        depthWrite: false,
        fragmentShader: particleFragmentShader,
        transparent: true,
        uniforms: uniformsRef.current,
        vertexShader: particleVertexShader,
      }),
    [],
  );

  useEffect(() => {
    geometry.setDrawRange(0, sceneQualityConfig[quality].particles);
  }, [geometry, quality]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(({ clock, viewport }) => {
    uniformsRef.current.uIntro.value = introProgress.get();
    uniformsRef.current.uProgress.value = storyProgress.get();
    uniformsRef.current.uTime.value = clock.elapsedTime;
    uniformsRef.current.uPointScale.value = Math.min(12, viewport.factor * 4.7);
    uniformsRef.current.uPointer.value.set(pointerX.get(), pointerY.get());
    if (pointsRef.current) {
      pointsRef.current.rotation.z = Math.sin(clock.elapsedTime * 0.12) * 0.015;
    }
  });

  return (
    <points
      frustumCulled={false}
      geometry={geometry}
      material={material}
      ref={pointsRef}
    />
  );
}

function LogoSurface({
  introProgress,
  logoGeometry,
  pointerX,
  pointerY,
  storyProgress,
}: SceneMotionProps & { logoGeometry: BufferGeometry }) {
  const meshRef = useRef<Mesh>(null);
  const uniformsRef = useRef({
    uIntro: { value: 0 },
    uPointer: { value: new Vector2() },
    uProgress: { value: 0 },
    uTime: { value: 0 },
  });
  const material = useMemo(
    () =>
      new ShaderMaterial({
        depthWrite: false,
        fragmentShader: logoFragmentShader,
        side: DoubleSide,
        transparent: true,
        uniforms: uniformsRef.current,
        vertexShader: logoVertexShader,
      }),
    [],
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock }) => {
    uniformsRef.current.uIntro.value = introProgress.get();
    uniformsRef.current.uProgress.value = storyProgress.get();
    uniformsRef.current.uTime.value = clock.elapsedTime;
    uniformsRef.current.uPointer.value.set(pointerX.get(), pointerY.get());
    if (meshRef.current) {
      meshRef.current.rotation.y = pointerX.get() * 0.055;
      meshRef.current.rotation.x = -pointerY.get() * 0.035;
    }
  });

  return <mesh geometry={logoGeometry} material={material} ref={meshRef} />;
}

const graphNodes = [
  [-2.6, 1.55, 0.1],
  [-1.25, 2.15, -0.35],
  [0.35, 1.55, 0.25],
  [2.2, 1.95, -0.2],
  [-2.3, -0.45, 0.35],
  [-0.65, -0.2, -0.25],
  [1.15, 0.1, 0.4],
  [2.65, -0.55, -0.3],
  [0.15, -1.8, 0.05],
] as const;

const graphEdges = [
  [0, 1],
  [1, 2],
  [2, 3],
  [0, 4],
  [1, 5],
  [2, 5],
  [2, 6],
  [3, 7],
  [4, 5],
  [5, 6],
  [6, 7],
  [5, 8],
  [6, 8],
] as const;

function NarrativeScaffolds({
  storyProgress,
}: Pick<SceneMotionProps, "storyProgress">) {
  const nodesRef = useRef<InstancedMesh>(null);
  const discoveryFramesRef = useRef<InstancedMesh>(null);
  const scoreRingsRef = useRef<InstancedMesh>(null);
  const nodeOpacityRef = useRef({ uOpacity: { value: 0 } });
  const lineOpacityRef = useRef({ uOpacity: { value: 0 } });
  const discoveryOpacityRef = useRef({ uOpacity: { value: 0 } });
  const scoreOpacityRef = useRef({ uOpacity: { value: 0 } });

  const graphGeometry = useMemo(() => {
    const positions: number[] = [];
    for (const [fromIndex, toIndex] of graphEdges) {
      positions.push(...graphNodes[fromIndex], ...graphNodes[toIndex]);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return geometry;
  }, []);

  const nodeMaterial = useMemo(
    () =>
      new ShaderMaterial({
        blending: AdditiveBlending,
        depthWrite: false,
        fragmentShader:
          "uniform float uOpacity; void main(){ gl_FragColor = vec4(0.12, 0.48, 0.38, uOpacity); }",
        transparent: true,
        uniforms: nodeOpacityRef.current,
        vertexShader:
          "void main(){ gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }",
      }),
    [],
  );
  const lineMaterial = useMemo(
    () =>
      new ShaderMaterial({
        blending: AdditiveBlending,
        depthWrite: false,
        fragmentShader:
          "uniform float uOpacity; void main(){ gl_FragColor = vec4(0.18, 0.58, 0.45, uOpacity); }",
        transparent: true,
        uniforms: lineOpacityRef.current,
        vertexShader:
          "void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      }),
    [],
  );
  const discoveryMaterial = useMemo(
    () =>
      new ShaderMaterial({
        depthWrite: false,
        fragmentShader:
          "uniform float uOpacity; void main(){ gl_FragColor = vec4(0.02, 0.31, 0.25, uOpacity); }",
        transparent: true,
        uniforms: discoveryOpacityRef.current,
        vertexShader:
          "void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        wireframe: true,
      }),
    [],
  );
  const scoreMaterial = useMemo(
    () =>
      new ShaderMaterial({
        blending: AdditiveBlending,
        depthWrite: false,
        fragmentShader:
          "uniform float uOpacity; void main(){ gl_FragColor = vec4(0.38, 0.72, 0.57, uOpacity); }",
        transparent: true,
        uniforms: scoreOpacityRef.current,
        vertexShader:
          "void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        wireframe: true,
      }),
    [],
  );

  useLayoutEffect(() => {
    const nodes = nodesRef.current;
    const matrix = new Matrix4();

    if (nodes) {
      graphNodes.forEach((node, index) => {
        matrix.makeTranslation(node[0], node[1], node[2]);
        nodes.setMatrixAt(index, matrix);
      });
      nodes.instanceMatrix.needsUpdate = true;
    }

    const discoveryFrames = discoveryFramesRef.current;
    if (discoveryFrames) {
      [-2.55, 0, 2.55].forEach((x, index) => {
        matrix.makeTranslation(x, 0, -0.08);
        discoveryFrames.setMatrixAt(index, matrix);
      });
      discoveryFrames.instanceMatrix.needsUpdate = true;
    }

    const scoreRings = scoreRingsRef.current;
    if (scoreRings) {
      matrix.identity();
      scoreRings.setMatrixAt(0, matrix);
      matrix.makeRotationX(Math.PI / 2);
      scoreRings.setMatrixAt(1, matrix);
      matrix.makeRotationY(Math.PI / 2);
      scoreRings.setMatrixAt(2, matrix);
      scoreRings.instanceMatrix.needsUpdate = true;
    }
  }, []);

  useEffect(
    () => () => {
      graphGeometry.dispose();
      nodeMaterial.dispose();
      lineMaterial.dispose();
      discoveryMaterial.dispose();
      scoreMaterial.dispose();
    },
    [
      discoveryMaterial,
      graphGeometry,
      lineMaterial,
      nodeMaterial,
      scoreMaterial,
    ],
  );

  useFrame(({ clock }) => {
    const progress = storyProgress.get();
    const persona =
      Math.max(0, Math.min(1, (progress - 0.1) / 0.1)) *
      (1 - Math.max(0, Math.min(1, (progress - 0.38) / 0.12)));
    const discovery =
      Math.max(0, Math.min(1, (progress - 0.32) / 0.1)) *
      (1 - Math.max(0, Math.min(1, (progress - 0.61) / 0.11)));
    const scoring =
      Math.max(0, Math.min(1, (progress - 0.54) / 0.12)) *
      (1 - Math.max(0, Math.min(1, (progress - 0.86) / 0.11)));

    nodeOpacityRef.current.uOpacity.value = persona * 0.45;
    lineOpacityRef.current.uOpacity.value = persona * 0.24;
    discoveryOpacityRef.current.uOpacity.value = discovery * 0.24;
    scoreOpacityRef.current.uOpacity.value = scoring * 0.36;
    if (nodesRef.current)
      nodesRef.current.rotation.z = clock.elapsedTime * 0.025;
  });

  return (
    <group>
      <instancedMesh
        args={[undefined, undefined, graphNodes.length]}
        ref={nodesRef}
      >
        <icosahedronGeometry args={[0.09, 1]} />
        <primitive attach="material" object={nodeMaterial} />
      </instancedMesh>
      <lineSegments geometry={graphGeometry}>
        <primitive attach="material" object={lineMaterial} />
      </lineSegments>
      <instancedMesh args={[undefined, undefined, 3]} ref={discoveryFramesRef}>
        <planeGeometry args={[1.5, 2.1, 5, 7]} />
        <primitive attach="material" object={discoveryMaterial} />
      </instancedMesh>
      <group rotation={[0.28, 0.18, 0]}>
        <instancedMesh args={[undefined, undefined, 3]} ref={scoreRingsRef}>
          <torusGeometry args={[1.95, 0.028, 5, 160]} />
          <primitive attach="material" object={scoreMaterial} />
        </instancedMesh>
      </group>
    </group>
  );
}

function PerformanceGovernor({
  onQualityChange,
  quality,
}: Pick<LandingThreeSceneProps, "onQualityChange" | "quality">) {
  const setDpr = useThree((state) => state.setDpr);
  const framesRef = useRef(0);
  const elapsedRef = useRef(0);
  const directionRef = useRef<"up" | "down" | null>(null);
  const streakRef = useRef(0);
  const lastChangeRef = useRef(-10);

  useEffect(() => {
    setDpr(sceneQualityConfig[quality].dpr);
  }, [quality, setDpr]);

  useFrame(({ clock }, delta) => {
    framesRef.current += 1;
    elapsedRef.current += delta;
    if (framesRef.current < 90 || elapsedRef.current < 1.2) return;

    const fps = framesRef.current / elapsedRef.current;
    framesRef.current = 0;
    elapsedRef.current = 0;
    const direction = fps < 45 ? "down" : fps > 57 ? "up" : null;

    if (!direction) {
      directionRef.current = null;
      streakRef.current = 0;
      return;
    }
    if (directionRef.current === direction) streakRef.current += 1;
    else {
      directionRef.current = direction;
      streakRef.current = 1;
    }

    if (
      streakRef.current >= 2 &&
      clock.elapsedTime - lastChangeRef.current >= 5
    ) {
      const next = stepSceneQuality(quality, direction);
      if (next !== quality) onQualityChange(next);
      lastChangeRef.current = clock.elapsedTime;
      streakRef.current = 0;
    }
  });

  return null;
}

function SceneContent(props: LandingThreeSceneProps) {
  const svg = useLoader(SVGLoader, "/prizgram-icon-refined.svg");
  const logoGeometry = useMemo(() => buildLogoGeometry(svg), [svg]);
  const viewportWidth = useThree((state) => state.size.width);
  const { onReady } = props;

  useEffect(() => {
    onReady();
    return () => logoGeometry.dispose();
  }, [logoGeometry, onReady]);

  return (
    <>
      <color args={["#f5f4ef"]} attach="background" />
      <fog args={["#f5f4ef", 8.5, 14]} attach="fog" />
      <group position={[viewportWidth >= 900 ? 1.85 : 0, 0, 0]}>
        <ParticleField {...props} logoGeometry={logoGeometry} />
        <LogoSurface {...props} logoGeometry={logoGeometry} />
        <NarrativeScaffolds storyProgress={props.storyProgress} />
      </group>
      <PerformanceGovernor
        onQualityChange={props.onQualityChange}
        quality={props.quality}
      />
    </>
  );
}

export default function LandingThreeScene(props: LandingThreeSceneProps) {
  return (
    <Canvas
      camera={{ far: 30, fov: 42, near: 0.1, position: [0, 0, 8.2] }}
      dpr={[1, sceneQualityConfig[props.quality].dpr]}
      fallback={<div className="landing-scene-webgl-fallback" />}
      frameloop={props.active ? "always" : "never"}
      gl={{
        alpha: true,
        antialias: props.quality !== "low",
        powerPreference: "high-performance",
      }}
      performance={{ debounce: 500, min: 0.5 }}
    >
      <Suspense fallback={null}>
        <SceneContent {...props} />
      </Suspense>
    </Canvas>
  );
}
