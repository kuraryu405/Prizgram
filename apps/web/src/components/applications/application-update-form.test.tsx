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
  useRouter: () => ({ refresh: navigationMocks.refresh }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigationMocks.refresh.mockClear();
});

const defaultProps: ApplicationUpdateFormProps = {
  applicationId: "application-1",
  currentStatus: "応募済み",
  allowedNextStatuses: ["interview"],
  statusLabels: { interview: "面接" },
  initialStageLabel: "書類選考",
  initialNextAction: "ESを提出する",
  initialNote: "提出前に見直す",
};

function successfulPatch() {
  return stubFetch(() => okEnvelope({}));
}

function submittedBody(fetchMock: ReturnType<typeof stubFetch>) {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("ApplicationUpdateForm", () => {
  test("renders current values and omits unchanged fields for status-only updates", async () => {
    const fetchMock = successfulPatch();
    const user = userEvent.setup();

    render(<ApplicationUpdateForm {...defaultProps} />);

    expect(screen.getByLabelText("現在の段階（任意）")).toHaveProperty(
      "value",
      "書類選考",
    );
    expect(screen.getByLabelText("次のアクション")).toHaveProperty(
      "value",
      "ESを提出する",
    );
    expect(screen.getByLabelText("メモ")).toHaveProperty(
      "value",
      "提出前に見直す",
    );

    await user.selectOptions(
      screen.getByLabelText("ステータス変更（任意）"),
      "interview",
    );
    await user.click(screen.getByRole("button", { name: "更新する" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(submittedBody(fetchMock)).toEqual({ status: "interview" });
  });

  test("sends null for cleared fields and becomes clean immediately after save", async () => {
    const fetchMock = successfulPatch();
    const user = userEvent.setup();

    render(<ApplicationUpdateForm {...defaultProps} />);

    await user.clear(screen.getByLabelText("現在の段階（任意）"));
    await user.clear(screen.getByLabelText("次のアクション"));
    await user.clear(screen.getByLabelText("メモ"));
    await user.click(screen.getByRole("button", { name: "更新する" }));

    await screen.findByRole("status");
    expect(submittedBody(fetchMock)).toEqual({
      stageLabel: null,
      nextAction: null,
      note: null,
    });
    expect(
      screen.getByRole("button", { name: "更新する" }).matches(":disabled"),
    ).toBe(true);
    expect(navigationMocks.refresh).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "更新する" }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("syncs new server props as the rendered values and clean baseline", async () => {
    const fetchMock = successfulPatch();
    const user = userEvent.setup();
    const view = render(<ApplicationUpdateForm {...defaultProps} />);

    view.rerender(
      <ApplicationUpdateForm
        {...defaultProps}
        initialStageLabel="1次面接"
        initialNextAction="面接日程を返信する"
        initialNote="候補日は金曜日"
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("現在の段階（任意）")).toHaveProperty(
        "value",
        "1次面接",
      ),
    );
    expect(screen.getByLabelText("次のアクション")).toHaveProperty(
      "value",
      "面接日程を返信する",
    );
    expect(screen.getByLabelText("メモ")).toHaveProperty(
      "value",
      "候補日は金曜日",
    );
    expect(
      screen.getByRole("button", { name: "更新する" }).matches(":disabled"),
    ).toBe(true);

    await user.type(screen.getByLabelText("次のアクション"), "（確認済み）");
    await user.click(screen.getByRole("button", { name: "更新する" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(submittedBody(fetchMock)).toEqual({
      nextAction: "面接日程を返信する（確認済み）",
    });
  });
});
