// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import RootError from "./error";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RootError", () => {
  test("calls the reset callback supplied by the Next.js error boundary", async () => {
    const error = new Error("unexpected route failure");
    const reset = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();

    render(<RootError error={error} reset={reset} />);

    await user.click(screen.getByRole("button", { name: "再試行" }));

    expect(reset).toHaveBeenCalledOnce();
  });
});
