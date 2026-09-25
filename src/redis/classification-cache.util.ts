import { createHash } from "node:crypto";
import {
  isTicketCategory,
  TicketClassificationResult,
} from "../tickets/ticket.types";

export const CLASSIFICATION_CACHE_PREFIX = "goodeva:classification:v1";

export interface ClassificationCacheEntry extends TicketClassificationResult {
  subject: string;
  message: string;
}

export function normalizeTicketText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function ticketTextFingerprint(
  subject: string,
  message: string,
): string {
  return createHash("sha256")
    .update(
      `${normalizeTicketText(subject)}\u0000${normalizeTicketText(message)}`,
    )
    .digest("hex");
}

export function ticketCacheKey(
  organizationId: string,
  subject: string,
  message: string,
): string {
  return `${CLASSIFICATION_CACHE_PREFIX}:${encodeURIComponent(
    organizationId,
  )}:${ticketTextFingerprint(subject, message)}`;
}

function tokenize(value: string): Set<string> {
  const normalized = normalizeTicketText(value);
  return new Set(normalized.length > 0 ? normalized.split(" ") : []);
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  return intersection / (left.size + right.size - intersection);
}

export function calculateTicketSimilarity(
  leftSubject: string,
  leftMessage: string,
  rightSubject: string,
  rightMessage: string,
): number {
  // Score the two meaningful parts independently. A small change in a short
  // subject should not make an otherwise identical long message look new,
  // while a completely different message should still prevent a false hit.
  return (
    (jaccardSimilarity(tokenize(leftSubject), tokenize(rightSubject)) +
      jaccardSimilarity(tokenize(leftMessage), tokenize(rightMessage))) /
    2
  );
}

export function isClassificationCacheEntry(
  value: unknown,
): value is ClassificationCacheEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Partial<ClassificationCacheEntry>;
  return (
    typeof entry.subject === "string" &&
    typeof entry.message === "string" &&
    isTicketCategory(entry.category) &&
    typeof entry.suggestedReply === "string" &&
    entry.suggestedReply.trim().length > 0
  );
}
