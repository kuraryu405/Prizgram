// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ToastProvider, useToast } from "./toast";

function Trigger({
  message,
  variant,
}: Readonly<{
  message: string;
  variant?: "success" | "error" | "warning" | "info";
}>) {
  const { addToast } = useToast();
  return (
    <button type="button" onClick={() => addToast(message, variant)}>
      trigger
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ToastProvider", () => {
  test("shows success toast with icon and label", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger message="求人を取り込みました" variant="success" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "trigger" }));
    expect(screen.getByRole("status").textContent).toContain(
      "求人を取り込みました",
    );
    expect(screen.getByText("成功")).toBeTruthy();
    expect(screen.getByText("✓")).toBeTruthy();
  });

  test("shows error toast as alert with assertive live", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger message="評価に失敗しました" variant="error" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "trigger" }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("評価に失敗しました");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(screen.getByText("エラー")).toBeTruthy();
  });

  test("dedupes identical message+variant", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger message="重複" variant="error" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "trigger" }));
    await user.click(screen.getByRole("button", { name: "trigger" }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  test("caps at 3 toasts", async () => {
    const user = userEvent.setup();
    function Multi() {
      const { addToast } = useToast();
      return (
        <div>
          <button type="button" onClick={() => addToast("m1", "info")}>
            m1
          </button>
          <button type="button" onClick={() => addToast("m2", "info")}>
            m2
          </button>
          <button type="button" onClick={() => addToast("m3", "info")}>
            m3
          </button>
          <button type="button" onClick={() => addToast("m4", "info")}>
            m4
          </button>
        </div>
      );
    }
    render(
      <ToastProvider>
        <Multi />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "m1" }));
    await user.click(screen.getByRole("button", { name: "m2" }));
    await user.click(screen.getByRole("button", { name: "m3" }));
    await user.click(screen.getByRole("button", { name: "m4" }));
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(3);
    // oldest evicted – m1 toast message gone but button remains
    expect(statuses.some((el) => el.textContent?.includes("m1"))).toBe(false);
    expect(statuses.some((el) => el.textContent?.includes("m4"))).toBe(true);
  });

  test("dismiss via button and keyboard", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger message="消せる" variant="info" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "trigger" }));
    expect(screen.getByRole("status")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "通知を閉じる" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  test("provides accessible region without stealing focus", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger message="focus" variant="info" />
        <input aria-label="keep-focus" />
      </ToastProvider>,
    );
    const input = screen.getByLabelText("keep-focus");
    input.focus();
    expect(document.activeElement).toBe(input);
    await user.click(screen.getByRole("button", { name: "trigger" }));
    // focus stays on input or trigger, not moved to toast
    expect(document.activeElement?.getAttribute("aria-label")).not.toBe(
      "通知を閉じる",
    );
  });

  test("auto-dismiss after duration", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <Trigger message="auto" variant="success" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "trigger" }));
    expect(screen.getByRole("status")).toBeTruthy();
    vi.advanceTimersByTime(5000);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
