// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";

import { ToastProvider, useToast } from "./toast";

function Trigger() {
  const { notify } = useToast();
  return (
    <div>
      <button
        onClick={() =>
          notify({ variant: "success", message: "保存しました。" })
        }
        type="button"
      >
        成功
      </button>
      <button
        onClick={() => notify({ variant: "error", message: "失敗しました。" })}
        type="button"
      >
        エラー
      </button>
    </div>
  );
}

afterEach(() => cleanup());

describe("ToastProvider", () => {
  test("announces variants with labels and deduplicates repeated messages", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "成功" }));
    await user.click(screen.getByRole("button", { name: "成功" }));
    await user.click(screen.getByRole("button", { name: "エラー" }));

    expect(screen.getAllByText("保存しました。")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("成功");
    expect(screen.getByRole("alert").textContent).toContain("エラー");
    expect(screen.getByRole("alert").textContent).toContain("失敗しました。");
  });

  test("can be dismissed with the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "成功" }));
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.queryByText("保存しました。")).toBeNull();
  });
});
