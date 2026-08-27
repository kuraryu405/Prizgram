import { describe, expect, test } from "vitest";

import {
  createParticleTargets,
  createSeededRandom,
  resolveNarrativeTransition,
  sceneQualityConfig,
  selectInitialSceneQuality,
  smoothstep,
  stepSceneQuality,
} from "./landing-scene-model";

describe("landing scene model", () => {
  test("uses a reproducible seeded random sequence", () => {
    const first = createSeededRandom(279);
    const second = createSeededRandom(279);
    expect(Array.from({ length: 8 }, first)).toEqual(
      Array.from({ length: 8 }, second),
    );
  });

  test("creates finite targets at the requested particle count", () => {
    const logo = new Float32Array([
      -1, -1, 0, 1, -1, 0.1, 1, 1, -0.1, -1, 1, 0,
    ]);
    const targets = createParticleTargets(logo, 128, 1234);

    for (const values of [
      targets.cloud,
      targets.logo,
      targets.persona,
      targets.discovery,
      targets.scoring,
      targets.learning,
      targets.colors,
    ]) {
      expect(values).toHaveLength(128 * 3);
      expect(Array.from(values).every(Number.isFinite)).toBe(true);
    }
    expect(targets.seeds).toHaveLength(128);
    expect(Array.from(targets.seeds).every(Number.isFinite)).toBe(true);
  });

  test("rejects incomplete logo coordinates", () => {
    expect(() => createParticleTargets(new Float32Array([0, 1]), 4)).toThrow(
      /complete xyz/,
    );
  });

  test("keeps narrative interpolation continuous at chapter boundaries", () => {
    expect(resolveNarrativeTransition(0)).toEqual({
      from: "logo",
      mix: 0,
      to: "persona",
    });
    expect(resolveNarrativeTransition(0.29)).toEqual({
      from: "persona",
      mix: 0,
      to: "discovery",
    });
    expect(resolveNarrativeTransition(0.51)).toEqual({
      from: "discovery",
      mix: 0,
      to: "scoring",
    });
    expect(resolveNarrativeTransition(1)).toEqual({
      from: "scoring",
      mix: 1,
      to: "learning",
    });
    expect(smoothstep(0.2, 0.4, 0.3)).toBeCloseTo(0.5);
  });

  test("selects and steps through adaptive quality levels", () => {
    expect(sceneQualityConfig).toEqual({
      balanced: { dpr: 1.25, particles: 10_000 },
      high: { dpr: 1.75, particles: 18_000 },
      low: { dpr: 1, particles: 4_000 },
    });
    expect(
      selectInitialSceneQuality({
        coarsePointer: false,
        deviceMemory: 8,
        hardwareConcurrency: 10,
        width: 1_440,
      }),
    ).toBe("high");
    expect(
      selectInitialSceneQuality({
        coarsePointer: false,
        deviceMemory: 4,
        hardwareConcurrency: 4,
        width: 900,
      }),
    ).toBe("balanced");
    expect(
      selectInitialSceneQuality({
        coarsePointer: true,
        deviceMemory: 8,
        hardwareConcurrency: 10,
        width: 1_440,
      }),
    ).toBe("low");
    expect(stepSceneQuality("high", "down")).toBe("balanced");
    expect(stepSceneQuality("balanced", "down")).toBe("low");
    expect(stepSceneQuality("low", "down")).toBe("low");
    expect(stepSceneQuality("low", "up")).toBe("balanced");
  });
});
