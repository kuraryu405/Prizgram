// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { errorEnvelope, okEnvelope, stubFetch } from "@/test-support/http";

import {
  DeadlineActions,
  formatDateTimeLocalInTimeZone,
} from "./deadline-components";

const navigationMocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigationMocks.refresh }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigationMocks.refresh.mockClear();
});

const deadline = {
  deadlineId: "deadline-1",
  title: "ES提出",
  kind: "document" as const,
  dueAt: "2026-08-30T05:00:00.000Z",
  timeZone: "Asia/Tokyo",
};

function submittedRequest(fetchMock: ReturnType<typeof stubFetch>) {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url: fetchMock.mock.calls[0]?.[0], init };
}

describe("formatDateTimeLocalInTimeZone", () => {
  test("uses the deadline timezone instead of the browser timezone", () => {
    expect(
      formatDateTimeLocalInTimeZone(deadline.dueAt, deadline.timeZone),
    ).toBe("2026-08-30T14:00");
  });
});

describe("DeadlineActions", () => {
  test("opens with current values and sends all editable fields on save", async () => {
    const fetchMock = stubFetch(() => okEnvelope({}));
    const user = userEvent.setup();
    render(<DeadlineActions {...deadline} />);

    await user.click(
      screen.getByRole("button", { name: "ES提出のその他の操作" }),
    );
    await user.click(screen.getByRole("button", { name: "編集" }));
    expect(screen.getByLabelText("タイトル")).toHaveProperty("value", "ES提出");
    expect(
      screen.getByLabelText("期限（Asia/Tokyoの現地時刻）"),
    ).toHaveProperty("value", "2026-08-30T14:00");

    await user.selectOptions(screen.getByLabelText("種別"), "interview");
    await user.clear(screen.getByLabelText("タイトル"));
    await user.type(screen.getByLabelText("タイトル"), "一次面接");
    await user.clear(screen.getByLabelText("期限（Asia/Tokyoの現地時刻）"));
    await user.type(
      screen.getByLabelText("期限（Asia/Tokyoの現地時刻）"),
      "2026-09-01T09:30",
    );
    await user.selectOptions(
      screen.getByLabelText("タイムゾーン"),
      "America/Los_Angeles",
    );
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const { url, init } = submittedRequest(fetchMock);
    expect(url).toBe("/api/deadlines/deadline-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      kind: "interview",
      title: "一次面接",
      dueLocal: "2026-09-01T09:30",
      timeZone: "America/Los_Angeles",
    });
    expect(navigationMocks.refresh).toHaveBeenCalledOnce();
  });

  test("does not delete before confirmation and respects cancellation", async () => {
    const fetchMock = stubFetch(() => okEnvelope(undefined));
    const user = userEvent.setup();
    render(<DeadlineActions {...deadline} />);

    await user.click(
      screen.getByRole("button", { name: "ES提出のその他の操作" }),
    );
    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "ES提出のその他の操作" }),
    );
    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const { url, init } = submittedRequest(fetchMock);
    expect(url).toBe("/api/deadlines/deadline-1");
    expect(init.method).toBe("DELETE");
  });

  test("shows API validation errors inside the edit dialog", async () => {
    stubFetch(() => errorEnvelope(400, "VALIDATION_ERROR"));
    const user = userEvent.setup();
    render(<DeadlineActions {...deadline} />);
    await user.click(
      screen.getByRole("button", { name: "ES提出のその他の操作" }),
    );
    await user.click(screen.getByRole("button", { name: "編集" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "入力内容を確認してください。",
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
