import { describe, it, expect } from "vitest";
import { formatDraft } from "../src/components/ui";
describe("application draft text", () => {
  it("retains nested question answers, evidence and budget without object coercion", () => {
    const text = formatDraft({
      sections: [
        {
          question: "What will you do?",
          answer: "Run twelve community meals.",
          evidence: ["Approved project plan"],
        },
      ],
      budget: [{ item: "Food", amount: 1200 }],
    });
    expect(text).toContain("What will you do?");
    expect(text).toContain("Run twelve community meals.");
    expect(text).toContain("Approved project plan");
    expect(text).toContain("1200");
    expect(text).not.toContain("[object Object]");
  });
});
