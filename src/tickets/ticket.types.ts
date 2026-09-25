export const TICKET_CATEGORIES = ["billing", "technical", "general"] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_STATUSES = ["open", "in_progress", "closed"] as const;

export type TicketStatusValue = (typeof TICKET_STATUSES)[number];

export interface TicketClassificationResult {
  category: TicketCategory;
  suggestedReply: string;
}

export function isTicketCategory(value: unknown): value is TicketCategory {
  return (
    typeof value === "string" &&
    (TICKET_CATEGORIES as readonly string[]).includes(value)
  );
}
