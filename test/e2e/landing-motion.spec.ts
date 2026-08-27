import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("motion-driven landing", () => {
  test("initializes the scene and advances through all four chapters", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.text().includes("401 (Unauthorized)")
      ) {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.setViewportSize({ height: 800, width: 1280 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: /選考を重ねるたび、\s*あなたを学習する。/,
      }),
    ).toBeVisible();
    await expect(page.locator(".landing-scene canvas")).toBeVisible();
    await expect(page.locator(".landing-narrative")).toHaveAttribute(
      "data-intro-state",
      "complete",
    );
    await expect(page.getByTestId("landing-static-logo")).toHaveCSS(
      "opacity",
      "1",
    );

    const chapters = ["persona", "discovery", "scoring", "learning"];
    const scrollPositions = [0.16, 0.4, 0.62, 0.88];
    for (const [index, chapter] of chapters.entries()) {
      await page.evaluate((progress) => {
        const narrative = document.querySelector(".landing-narrative");
        if (!(narrative instanceof HTMLElement)) return;
        const travel = narrative.offsetHeight - window.innerHeight;
        window.scrollTo({ behavior: "instant", top: travel * progress });
      }, scrollPositions[index]);
      await expect(page.locator(".landing-narrative")).toHaveAttribute(
        "data-active-chapter",
        chapter,
      );
    }

    await page.evaluate(() => {
      const narrative = document.querySelector(".landing-narrative");
      if (!(narrative instanceof HTMLElement)) return;
      window.scrollTo({
        behavior: "instant",
        top: (narrative.offsetHeight - window.innerHeight) * 0.99,
      });
    });
    await expect(page.getByTestId("landing-static-logo")).toHaveCSS(
      "opacity",
      "1",
    );

    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  for (const width of [390, 768, 1280]) {
    test(`keeps content and CTAs usable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ height: 844, width });
      await page.goto("/");
      await expectNoHorizontalOverflow(page);

      const finalCta = page.getByRole("link", { name: /Prizgramをはじめる/ });
      await finalCta.scrollIntoViewIfNeeded();
      await expect(finalCta).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test("does not create WebGL canvas when reduced motion is requested", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    await expect(page.locator(".landing-scene canvas")).toHaveCount(0);
    await expect(page.getByTestId("landing-static-logo")).toBeVisible();
    await expect(page.locator(".landing-narrative")).toHaveAttribute(
      "data-intro-state",
      "complete",
    );
    await expect(
      page.getByRole("button", { name: "イントロをスキップ" }),
    ).toHaveCount(0);
  });

  test("replays the intro after a persisted page restore", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "イントロをスキップ" }).click();
    await expect(page.locator(".landing-narrative")).toHaveAttribute(
      "data-intro-state",
      "complete",
    );

    await page.evaluate(() => {
      const event = new PageTransitionEvent("pageshow", { persisted: true });
      window.dispatchEvent(event);
    });

    await expect(
      page.getByRole("button", { name: "イントロをスキップ" }),
    ).toBeVisible();
    await expect(page.locator(".landing-narrative")).toHaveAttribute(
      "data-intro-state",
      "running",
    );
  });

  test("keeps the static logo and content when WebGL is unavailable", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(
        contextId: string,
        ...args: unknown[]
      ) {
        if (contextId.startsWith("webgl")) return null;
        return Reflect.apply(originalGetContext, this, [contextId, ...args]);
      } as typeof originalGetContext;
    });
    await page.goto("/");

    await expect(page.getByTestId("landing-static-logo")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /選考を重ねるたび、\s*あなたを学習する。/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /ペルソナ作成をはじめる/ }),
    ).toBeVisible();
  });
});
