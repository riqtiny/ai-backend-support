import {
  calculateTicketSimilarity,
  normalizeTicketText,
  ticketTextFingerprint,
} from "./classification-cache.util";

describe("classification cache utilities", () => {
  it("normalizes equivalent text before fingerprinting", () => {
    const first = normalizeTicketText("  Invoice   QUESTION!  ");
    const second = normalizeTicketText("invoice question");

    expect(first).toBe(second);
    expect(ticketTextFingerprint("A", "B")).toBe(
      ticketTextFingerprint("a", "b"),
    );
  });

  it("recognizes a small wording change as a near duplicate", () => {
    const similarity = calculateTicketSimilarity(
      "Unable to access my account",
      "The login page returns an error when I sign in.",
      "Unable to access account",
      "The login page returns an error when I sign in.",
    );

    expect(similarity).toBeGreaterThanOrEqual(0.85);
  });
});
