export type SceneQuality = "high" | "balanced" | "low";

export type SceneQualityConfig = {
  dpr: number;
  particles: number;
};

export type SceneEnvironment = {
  coarsePointer: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  width: number;
};

export type NarrativeTargetName =
  "logo" | "persona" | "discovery" | "scoring" | "learning";

export type NarrativeTransition = {
  from: NarrativeTargetName;
  mix: number;
  to: NarrativeTargetName;
};

export type ParticleTargets = {
  cloud: Float32Array;
  colors: Float32Array;
  discovery: Float32Array;
  learning: Float32Array;
  logo: Float32Array;
  persona: Float32Array;
  scoring: Float32Array;
  seeds: Float32Array;
};

export const MAX_PARTICLE_COUNT = 18_000;

export const sceneQualityConfig: Record<SceneQuality, SceneQualityConfig> = {
  high: { dpr: 1.75, particles: MAX_PARTICLE_COUNT },
  balanced: { dpr: 1.25, particles: 10_000 },
  low: { dpr: 1, particles: 4_000 },
};

const palette = [
  [0.0078, 0.2902, 0.2471],
  [0.1961, 0.6863, 0.5843],
  [0.7451, 0.851, 0.6627],
  [0.9765, 0.949, 0.6392],
] as const;

const personaNodes = [
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

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function smoothstep(start: number, end: number, value: number): number {
  const normalized = clamp01((value - start) / (end - start));
  return normalized * normalized * (3 - 2 * normalized);
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function selectInitialSceneQuality(
  environment: SceneEnvironment,
): SceneQuality {
  const cores = environment.hardwareConcurrency ?? 4;
  const memory = environment.deviceMemory ?? 4;

  if (
    !environment.coarsePointer &&
    environment.width >= 1_200 &&
    cores >= 8 &&
    memory >= 8
  ) {
    return "high";
  }

  if (
    !environment.coarsePointer &&
    environment.width >= 760 &&
    cores >= 4 &&
    memory >= 4
  ) {
    return "balanced";
  }

  return "low";
}

export function stepSceneQuality(
  quality: SceneQuality,
  direction: "up" | "down",
): SceneQuality {
  const ordered: SceneQuality[] = ["low", "balanced", "high"];
  const index = ordered.indexOf(quality);
  const nextIndex = direction === "up" ? index + 1 : index - 1;
  return ordered[Math.min(ordered.length - 1, Math.max(0, nextIndex))]!;
}

export function resolveNarrativeTransition(
  progress: number,
): NarrativeTransition {
  const value = clamp01(progress);

  if (value < 0.29) {
    return {
      from: "logo",
      to: "persona",
      mix: smoothstep(0.08, 0.29, value),
    };
  }
  if (value < 0.51) {
    return {
      from: "persona",
      to: "discovery",
      mix: smoothstep(0.29, 0.51, value),
    };
  }
  if (value < 0.73) {
    return {
      from: "discovery",
      to: "scoring",
      mix: smoothstep(0.51, 0.73, value),
    };
  }
  return {
    from: "scoring",
    to: "learning",
    mix: smoothstep(0.73, 0.96, value),
  };
}

function writeVector(
  target: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
): void {
  const offset = index * 3;
  target[offset] = x;
  target[offset + 1] = y;
  target[offset + 2] = z;
}

export function createParticleTargets(
  logoPositions: Float32Array,
  count = MAX_PARTICLE_COUNT,
  seed = 2_790_117,
): ParticleTargets {
  if (logoPositions.length < 3 || logoPositions.length % 3 !== 0) {
    throw new Error("logoPositions must contain complete xyz coordinates");
  }

  const random = createSeededRandom(seed);
  const cloud = new Float32Array(count * 3);
  const logo = new Float32Array(count * 3);
  const persona = new Float32Array(count * 3);
  const discovery = new Float32Array(count * 3);
  const scoring = new Float32Array(count * 3);
  const learning = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const logoPointCount = logoPositions.length / 3;

  for (let index = 0; index < count; index += 1) {
    const logoIndex = (index % logoPointCount) * 3;
    const logoX = logoPositions[logoIndex]!;
    const logoY = logoPositions[logoIndex + 1]!;
    const logoZ = logoPositions[logoIndex + 2]!;

    writeVector(logo, index, logoX, logoY, logoZ);

    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const radius = 3.2 + random() * 3.8;
    writeVector(
      cloud,
      index,
      Math.sin(phi) * Math.cos(theta) * radius,
      Math.cos(phi) * radius,
      Math.sin(phi) * Math.sin(theta) * radius,
    );

    const node = personaNodes[index % personaNodes.length]!;
    const nodeSpread = 0.16 + random() * 0.42;
    writeVector(
      persona,
      index,
      node[0] + (random() - 0.5) * nodeSpread,
      node[1] + (random() - 0.5) * nodeSpread,
      node[2] + (random() - 0.5) * 0.7,
    );

    const lane = index % 3;
    const laneX = (lane - 1) * 2.55;
    const edgeProgress = random();
    const edge = index % 4;
    const cardWidth = 1.45;
    const cardHeight = 2.05;
    let cardX = laneX;
    let cardY = 0;
    if (edge === 0) {
      cardX += (edgeProgress - 0.5) * cardWidth;
      cardY = cardHeight / 2;
    } else if (edge === 1) {
      cardX += cardWidth / 2;
      cardY = (edgeProgress - 0.5) * cardHeight;
    } else if (edge === 2) {
      cardX += (0.5 - edgeProgress) * cardWidth;
      cardY = -cardHeight / 2;
    } else {
      cardX -= cardWidth / 2;
      cardY = (0.5 - edgeProgress) * cardHeight;
    }
    writeVector(
      discovery,
      index,
      cardX + (random() - 0.5) * 0.08,
      cardY + (random() - 0.5) * 0.08,
      (lane - 1) * -0.34 + Math.sin(edgeProgress * Math.PI) * 0.16,
    );

    const ring = index % 3;
    const ringAngle = random() * Math.PI * 2;
    const ringRadius = 1.65 + random() * 0.55;
    const wobble = (random() - 0.5) * 0.14;
    if (ring === 0) {
      writeVector(
        scoring,
        index,
        Math.cos(ringAngle) * ringRadius,
        Math.sin(ringAngle) * ringRadius,
        wobble,
      );
    } else if (ring === 1) {
      writeVector(
        scoring,
        index,
        Math.cos(ringAngle) * ringRadius,
        wobble,
        Math.sin(ringAngle) * ringRadius,
      );
    } else {
      writeVector(
        scoring,
        index,
        wobble,
        Math.cos(ringAngle) * ringRadius,
        Math.sin(ringAngle) * ringRadius,
      );
    }

    writeVector(
      learning,
      index,
      logoX * 1.035,
      logoY * 1.035,
      logoZ + Math.sin(index * 0.021) * 0.14,
    );

    const color = palette[Math.floor(random() * palette.length)]!;
    writeVector(colors, index, color[0], color[1], color[2]);
    seeds[index] = random();
  }

  return {
    cloud,
    colors,
    discovery,
    learning,
    logo,
    persona,
    scoring,
    seeds,
  };
}
