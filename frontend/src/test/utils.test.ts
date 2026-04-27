import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("merges tailwind classes, last wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
  it("handles conditional classes", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
});
