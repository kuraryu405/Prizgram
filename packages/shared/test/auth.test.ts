import { describe, expect, it } from "vitest";

import { credentialsSchema } from "../src";

describe("credentialsSchema", () => {
  it("normalizes login IDs", () => {
    expect(
      credentialsSchema.parse({
        loginId: " Student.Name ",
        password: "long-enough-password",
      }),
    ).toEqual({
      loginId: "student.name",
      password: "long-enough-password",
    });
  });

  it("rejects unsafe IDs and weak passwords", () => {
    expect(
      credentialsSchema.safeParse({ loginId: "学生", password: "short" })
        .success,
    ).toBe(false);
  });
});
