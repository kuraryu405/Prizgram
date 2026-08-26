// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ErrorRecovery } from "./error-recovery";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ErrorRecovery", () => {
  test("shows an accessible recovery action without exposing error details", async () => {
    const error = new Error("database credentials must stay private");
    const reset = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const user = userEvent.setup();

    render(<ErrorRecovery error={error} reset={reset} />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "画面の読み込みに失敗しました",
      }),
    ).toBeTruthy();
    expect(screen.queryByText(error.message)).toBeNull();
    expect(screen.getByRole("link", { name: "ホームへ戻る" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "再試行" }));

    expect(reset).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith("Unexpected route error", error);
  });
});
