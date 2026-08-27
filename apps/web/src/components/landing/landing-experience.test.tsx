// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { LandingExperience } from "./landing-experience";

const motionState = vi.hoisted(() => ({ reduced: false, sceneFails: false }));

vi.mock("motion/react", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    useReducedMotion: () => motionState.reduced,
  };
});

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockThreeScene() {
      if (motionState.sceneFails) throw new Error("WebGL unavailable");
      return <div data-testid="mock-three-scene" />;
    },
}));

class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

class IntersectionObserverStub {
  constructor(private readonly callback: IntersectionObserverCallback) {}

  disconnect() {}

  observe(element: Element) {
    this.callback(
      [
        {
          boundingClientRect: element.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: element.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target: element,
          time: 0,
        },
      ],
      this as unknown as IntersectionObserver,
    );
  }

  takeRecords() {
    return [];
  }

  unobserve() {}
}

beforeEach(() => {
  motionState.reduced = false;
  motionState.sceneFails = false;
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: query.includes("prefers-reduced-motion")
        ? motionState.reduced
        : false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LandingExperience", () => {
  test("renders the product loop and account CTAs", () => {
    render(<LandingExperience />);

    expect(
      screen.getByRole("heading", {
        name: /選考を重ねるたび、あなたを学習する。/,
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: /話したことが/ }),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { name: /探し方まで/ })).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: /マッチ率ひとつで/ }),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { name: /選考結果を/ })).not.toBeNull();
    expect(screen.getByText(/許諾された求人検索API/)).not.toBeNull();
    expect(screen.getByText(/応募の自動送信/)).not.toBeNull();
    expect(
      screen
        .getAllByRole("link", { name: /はじめる/ })
        .some((link) => link.getAttribute("href") === "/register"),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("link", { name: /ログイン|アカウント/ })
        .some((link) => link.getAttribute("href") === "/login"),
    ).toBe(true);
  });

  test("allows the intro to be skipped and replays on bfcache restore", async () => {
    const user = userEvent.setup();
    render(<LandingExperience />);

    await user.click(
      screen.getByRole("button", { name: "イントロをスキップ" }),
    );
    expect(
      screen.queryByRole("button", { name: "イントロをスキップ" }),
    ).toBeNull();

    const pageShow = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(pageShow, "persisted", { value: true });
    window.dispatchEvent(pageShow);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "イントロをスキップ" }),
      ).not.toBeNull(),
    );
  });

  test("uses the static experience when reduced motion is requested", () => {
    motionState.reduced = true;
    render(<LandingExperience />);

    expect(screen.queryByTestId("mock-three-scene")).toBeNull();
    expect(screen.getByTestId("landing-static-logo")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "イントロをスキップ" }),
    ).toBeNull();
    expect(
      document
        .querySelector(".landing-narrative")
        ?.getAttribute("data-intro-state"),
    ).toBe("complete");
  });

  test("keeps the static fallback when the 3D scene fails", () => {
    motionState.sceneFails = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<LandingExperience />);

    expect(screen.getByTestId("landing-static-logo")).not.toBeNull();
    expect(screen.queryByTestId("mock-three-scene")).toBeNull();
    expect(
      screen.getByRole("heading", {
        name: /選考を重ねるたび、あなたを学習する。/,
      }),
    ).not.toBeNull();
    errorSpy.mockRestore();
  });
});
