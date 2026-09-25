import { Ticket } from "@prisma/client";
import { ClassificationCacheService } from "../redis/classification-cache.service";
import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { TicketsService } from "./tickets.service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const ticketId = "22222222-2222-4222-8222-222222222222";

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: ticketId,
    organizationId,
    customerEmail: "customer@example.com",
    subject: "Invoice question",
    message: "I cannot see my invoice.",
    category: null,
    suggestedReply: null,
    status: "open",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("TicketsService", () => {
  function createService() {
    const prisma = {
      ticket: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const cache = {
      get: jest.fn(),
      set: jest.fn(),
    };
    const llm = {
      classifyAndDraft: jest.fn(),
    };

    return {
      prisma,
      cache,
      llm,
      service: new TicketsService(
        prisma as unknown as PrismaService,
        cache as unknown as ClassificationCacheService,
        llm as unknown as LlmService,
      ),
    };
  }

  it("creates first and scopes enrichment to the authenticated organization", async () => {
    const { service, prisma, cache, llm } = createService();
    const original = makeTicket();
    const enriched = makeTicket({
      category: "billing",
      suggestedReply: "We will review the invoice for you.",
    });

    prisma.ticket.create.mockResolvedValue(original);
    cache.get.mockResolvedValue(null);
    llm.classifyAndDraft.mockResolvedValue({
      category: "billing",
      suggestedReply: enriched.suggestedReply,
    });
    prisma.ticket.updateMany.mockResolvedValue({ count: 1 });
    prisma.ticket.findFirst.mockResolvedValue(enriched);

    const result = await service.createTicket(
      {
        customerEmail: original.customerEmail,
        subject: original.subject,
        message: original.message,
      },
      organizationId,
    );

    expect(prisma.ticket.create).toHaveBeenCalledWith({
      data: {
        organizationId,
        customerEmail: original.customerEmail,
        subject: original.subject,
        message: original.message,
      },
    });
    expect(llm.classifyAndDraft).toHaveBeenCalledWith({
      subject: original.subject,
      message: original.message,
    });
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: ticketId, organizationId },
      data: {
        category: "billing",
        suggestedReply: enriched.suggestedReply,
      },
    });
    expect(cache.set).toHaveBeenCalledWith(
      organizationId,
      original.subject,
      original.message,
      { category: "billing", suggestedReply: enriched.suggestedReply },
    );
    expect(result).toEqual(enriched);
  });

  it("continues to the LLM when Redis lookup fails", async () => {
    const { service, prisma, cache, llm } = createService();
    const original = makeTicket();
    const enriched = makeTicket({
      category: "general",
      suggestedReply: "Thanks for contacting support.",
    });

    prisma.ticket.create.mockResolvedValue(original);
    cache.get.mockRejectedValue(new Error("redis unavailable"));
    llm.classifyAndDraft.mockResolvedValue({
      category: "general",
      suggestedReply: enriched.suggestedReply,
    });
    prisma.ticket.updateMany.mockResolvedValue({ count: 1 });
    prisma.ticket.findFirst.mockResolvedValue(enriched);

    const result = await service.createTicket(
      {
        customerEmail: original.customerEmail,
        subject: original.subject,
        message: original.message,
      },
      organizationId,
    );

    expect(llm.classifyAndDraft).toHaveBeenCalled();
    expect(result.category).toBe("general");
  });

  it("keeps the ticket when LLM enrichment rejects", async () => {
    const { service, prisma, cache, llm } = createService();
    const original = makeTicket();

    prisma.ticket.create.mockResolvedValue(original);
    cache.get.mockResolvedValue(null);
    llm.classifyAndDraft.mockRejectedValue(new Error("rate limited"));
    prisma.ticket.findFirst.mockResolvedValue(original);

    const result = await service.createTicket(
      {
        customerEmail: original.customerEmail,
        subject: original.subject,
        message: original.message,
      },
      organizationId,
    );

    expect(result).toEqual(original);
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it("uses a cache hit without calling the LLM", async () => {
    const { service, prisma, cache, llm } = createService();
    const original = makeTicket();
    const enriched = makeTicket({
      category: "technical",
      suggestedReply: "Please try again in a moment.",
    });

    prisma.ticket.create.mockResolvedValue(original);
    cache.get.mockResolvedValue({
      category: "technical",
      suggestedReply: enriched.suggestedReply,
    });
    prisma.ticket.updateMany.mockResolvedValue({ count: 1 });
    prisma.ticket.findFirst.mockResolvedValue(enriched);

    await service.createTicket(
      {
        customerEmail: original.customerEmail,
        subject: original.subject,
        message: original.message,
      },
      organizationId,
    );

    expect(llm.classifyAndDraft).not.toHaveBeenCalled();
    expect(prisma.ticket.updateMany).toHaveBeenCalled();
  });

  it("always includes organizationId in list queries", async () => {
    const { service, prisma } = createService();
    prisma.ticket.findMany.mockResolvedValue([]);

    await service.listTickets(organizationId, { status: "open" });

    expect(prisma.ticket.findMany).toHaveBeenCalledWith({
      where: { organizationId, status: "open" },
      orderBy: { createdAt: "desc" },
    });
  });
});
