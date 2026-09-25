import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Ticket, TicketStatus } from "@prisma/client";
import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { ClassificationCacheService } from "../redis/classification-cache.service";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { ListTicketsQueryDto } from "./dto/list-tickets-query.dto";
import { UpdateTicketStatusDto } from "./dto/update-ticket-status.dto";
import { TicketClassificationResult } from "./ticket.types";

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly classificationCache: ClassificationCacheService,
    private readonly llm: LlmService,
  ) {}

  async createTicket(
    input: CreateTicketDto,
    organizationId: string,
  ): Promise<Ticket> {
    const customerEmail = input.customerEmail ?? input.customer_email;
    if (!customerEmail) {
      throw new BadRequestException("customerEmail is required");
    }

    // Persist first. LLM enrichment is deliberately best-effort.
    const ticket = await this.prisma.ticket.create({
      data: {
        organizationId,
        customerEmail,
        subject: input.subject,
        message: input.message,
      },
    });

    return this.enrichTicket(ticket);
  }

  async listTickets(
    organizationId: string,
    filters: ListTicketsQueryDto,
  ): Promise<Ticket[]> {
    const where: Prisma.TicketWhereInput = { organizationId };

    if (filters.status) {
      where.status = filters.status as TicketStatus;
    }
    if (filters.category) {
      where.category = filters.category;
    }

    return this.prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
  }

  async getTicket(id: string, organizationId: string): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, organizationId },
    });

    if (!ticket) {
      // Deliberately do not disclose whether the id exists in another tenant.
      throw new NotFoundException("Ticket not found");
    }

    return ticket;
  }

  async updateTicketStatus(
    id: string,
    organizationId: string,
    input: UpdateTicketStatusDto,
  ): Promise<Ticket> {
    const result = await this.prisma.ticket.updateMany({
      where: { id, organizationId },
      data: { status: input.status as TicketStatus },
    });

    if (result.count === 0) {
      throw new NotFoundException("Ticket not found");
    }

    const ticket = await this.prisma.ticket.findFirst({
      where: { id, organizationId },
    });
    if (!ticket) {
      throw new NotFoundException("Ticket not found");
    }

    return ticket;
  }

  private async enrichTicket(ticket: Ticket): Promise<Ticket> {
    let result: TicketClassificationResult | null = null;

    try {
      result = await this.classificationCache.get(
        ticket.organizationId,
        ticket.subject,
        ticket.message,
      );
    } catch (error) {
      // Redis is an optimization; a failure must not suppress the LLM path.
      this.logger.warn(
        `Classification cache lookup failed for ${ticket.id}: ${this.errorMessage(error)}`,
      );
    }

    if (!result) {
      try {
        result = await this.llm.classifyAndDraft({
          subject: ticket.subject,
          message: ticket.message,
        });
      } catch (error) {
        // LLM enrichment is best-effort and must never undo ticket creation.
        this.logger.warn(
          `Ticket enrichment failed for ${ticket.id}: ${this.errorMessage(error)}`,
        );
      }
    }

    if (result) {
      try {
        const updated = await this.prisma.ticket.updateMany({
          where: { id: ticket.id, organizationId: ticket.organizationId },
          data: {
            category: result.category,
            suggestedReply: result.suggestedReply,
          },
        });

        if (updated.count > 0) {
          try {
            await this.classificationCache.set(
              ticket.organizationId,
              ticket.subject,
              ticket.message,
              result,
            );
          } catch (error) {
            this.logger.warn(
              `Classification cache write failed for ${ticket.id}: ${this.errorMessage(error)}`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `Could not persist enrichment for ${ticket.id}: ${this.errorMessage(error)}`,
        );
      }
    }

    try {
      return (
        (await this.prisma.ticket.findFirst({
          where: { id: ticket.id, organizationId: ticket.organizationId },
        })) ?? ticket
      );
    } catch (error) {
      this.logger.warn(
        `Could not reload ticket ${ticket.id} after enrichment: ${this.errorMessage(error)}`,
      );
      return ticket;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
