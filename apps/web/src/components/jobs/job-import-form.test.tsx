// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { errorEnvelope, okEnvelope, stubFetch } from "@/test-support/http";

import { ToastProvider } from "@/components/app/toast";

import { JobImportForm } from "./job-import-form";

const navigationMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: navigationMocks.refresh,
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigationMocks.refresh.mockClear();
});

async function fillValidBody(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.type(screen.getByLabelText("求人票本文"), "a".repeat(40));
}

describe("JobImportForm", () => {
  test("limits companyName to the server's 200 character boundary", async () => {
    stubFetch((url, init) => {
      if (url === "/api/jobs" && init?.method === "POST") {
        return okEnvelope({
          jobId: "job-1",
          jobVersionId: "version-1",
          version: 1,
          duplicate: false,
        });
      }
      throw new Error(`unexpected request to ${url}`);
    });

    const user = userEvent.setup();
    render(
      <ToastProvider>
        <JobImportForm />
      </ToastProvider>,
    );
    await fillValidBody(user);

    const companyInput = screen.getByLabelText("会社名（任意）");
    expect(companyInput.getAttribute("maxlength")).toBe("200");

    await user.type(companyInput, "x".repeat(201));
    expect(companyInput).toHaveProperty("value", "x".repeat(200));

    await user.click(screen.getByRole("button", { name: "求人票を取り込む" }));
    await waitFor(() => expect(navigationMocks.refresh).toHaveBeenCalledOnce());
  });

  test("renders companyName field errors and accessible invalid state", async () => {
    stubFetch((url, init) => {
      if (url === "/api/jobs" && init?.method === "POST") {
        return errorEnvelope(400, "VALIDATION_ERROR", "invalid", {
          companyName: ["200文字以内で入力してください。"],
        });
      }
      throw new Error(`unexpected request to ${url}`);
    });

    const user = userEvent.setup();
    render(
      <ToastProvider>
        <JobImportForm />
      </ToastProvider>,
    );
    await fillValidBody(user);
    await user.type(screen.getByLabelText("会社名（任意）"), "Sample Inc.");
    await user.click(screen.getByRole("button", { name: "求人票を取り込む" }));

    const companyInput = screen.getByLabelText("会社名（任意）");
    await waitFor(() =>
      expect(
        screen.getByText("会社名: 200文字以内で入力してください。"),
      ).toBeTruthy(),
    );
    expect(companyInput.getAttribute("aria-invalid")).toBe("true");
    expect(companyInput.getAttribute("aria-describedby")).toBe(
      "job-company-name-error",
    );
  });

  test("falls back to a general error when the server reports an unknown field", async () => {
    stubFetch((url, init) => {
      if (url === "/api/jobs" && init?.method === "POST") {
        return errorEnvelope(400, "VALIDATION_ERROR", "invalid", {
          unexpectedField: ["invalid"],
        });
      }
      throw new Error(`unexpected request to ${url}`);
    });

    const user = userEvent.setup();
    render(
      <ToastProvider>
        <JobImportForm />
      </ToastProvider>,
    );
    await fillValidBody(user);
    await user.click(screen.getByRole("button", { name: "求人票を取り込む" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "入力内容を確認してください。",
      ),
    );
  });
});
