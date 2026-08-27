// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { okEnvelope, stubFetch } from "@/test-support/http";

import {
  ApplicationUpdateForm,
  type ApplicationUpdateFormProps,
} from "./application-update-form";

const navigationMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: navigationMocks.refresh,
  }),
}));

const defaultProps: ApplicationUpdateFormProps = {
  applicationId: "application-1",
  currentStatus: "saved",
  allowedNextStatuses: ["applying"],
  statusLabels: { applying: "応募中" },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigationMocks.refresh.mockClear();
});

function successfulPatch() {
  return stubFetch((url, init) => {
    if (url === "/api/applications/application-1" && init?.method === "PATCH") {
      return okEnvelope({});
    }
    throw new Error(`unexpected request to ${url}`);
  });
}

function requestBodies(fetchMock: ReturnType<typeof stubFetch>): unknown[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/applications/application-1")
    .map(([, init]) => JSON.parse((init?.body ?? "{}") as string) as unknown);
}

describe("ApplicationUpdateForm", () => {
  test("renders current values and starts clean", () => {
    render(
      <ApplicationUpdateForm
        {...defaultProps}
        initialNextAction="ESを書く"
        initialNote="採用ページを確認"
      />,
    );

    expect(
      (screen.getByLabelText("次のアクション") as HTMLInputElement).value,
    ).toBe("ESを書く");
    expect(
      (
        screen.getByLabelText(
          "メモ（ステータス変更時の履歴に記録）",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("採用ページを確認");
    expect(
      screen.getByRole("button", { name: "更新する" }).matches(":disabled"),
    ).toBe(true);
  });

  test("sends null for cleared fields and becomes clean immediately after success", async () => {
    const fetchMock = successfulPatch();
    const user = userEvent.setup();
    render(
      <ApplicationUpdateForm
        {...defaultProps}
        initialNextAction="ESを書く"
        initialNote="採用ページを確認"
      />,
    );

    await user.clear(screen.getByLabelText("次のアクション"));
    await user.clear(
      screen.getByLabelText("メモ（ステータス変更時の履歴に記録）"),
    );
    await user.click(screen.getByRole("button", { name: "更新する" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("更新しました"),
    );
    expect(requestBodies(fetchMock)).toEqual([
      { nextAction: null, note: null },
    ]);

    const submit = screen.getByRole("button", { name: "更新する" });
    expect(submit.matches(":disabled")).toBe(true);
    await user.click(submit);
    expect(requestBodies(fetchMock)).toHaveLength(1);
  });

  test("omits unchanged text fields for a status-only update", async () => {
    const fetchMock = successfulPatch();
    const user = userEvent.setup();
    render(
      <ApplicationUpdateForm
        {...defaultProps}
        initialNextAction="ESを書く"
        initialNote="採用ページを確認"
      />,
    );

    await user.selectOptions(screen.getByLabelText("ステータス変更（任意）"), "applying");
    await user.click(screen.getByRole("button", { name: "更新する" }));

    await waitFor(() => expect(requestBodies(fetchMock)).toHaveLength(1));
    expect(requestBodies(fetchMock)[0]).toEqual({ status: "applying" });
  });

  test("uses refreshed server props as the new dirty baseline", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ApplicationUpdateForm
        {...defaultProps}
        initialNextAction="旧アクション"
        initialNote="旧メモ"
      />,
    );

    rerender(
      <ApplicationUpdateForm
        {...defaultProps}
        initialNextAction="新アクション"
        initialNote="新メモ"
      />,
    );

    const nextAction = screen.getByLabelText("次のアクション") as HTMLInputElement;
    const note = screen.getByLabelText(
      "メモ（ステータス変更時の履歴に記録）",
    ) as HTMLTextAreaElement;
    await waitFor(() => expect(nextAction.value).toBe("新アクション"));
    expect(note.value).toBe("新メモ");
    expect(
      screen.getByRole("button", { name: "更新する" }).matches(":disabled"),
    ).toBe(true);

    await user.type(nextAction, "追記");
    expect(
      screen.getByRole("button", { name: "更新する" }).matches(":disabled"),
    ).toBe(false);
  });
});
