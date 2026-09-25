import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiKeyGuard } from "../auth/api-key.guard";
import { CurrentOrganization } from "../auth/current-organization.decorator";
import { AuthenticatedOrganization } from "../auth/authenticated-request";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { ListTicketsQueryDto } from "./dto/list-tickets-query.dto";
import { UpdateTicketStatusDto } from "./dto/update-ticket-status.dto";
import { TicketsService } from "./tickets.service";

@Controller("tickets")
@UseGuards(ApiKeyGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  create(
    @Body() input: CreateTicketDto,
    @CurrentOrganization() organization: AuthenticatedOrganization,
  ) {
    return this.ticketsService.createTicket(input, organization.id);
  }

  @Get()
  list(
    @Query() filters: ListTicketsQueryDto,
    @CurrentOrganization() organization: AuthenticatedOrganization,
  ) {
    return this.ticketsService.listTickets(organization.id, filters);
  }

  @Get(":id")
  get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentOrganization() organization: AuthenticatedOrganization,
  ) {
    return this.ticketsService.getTicket(id, organization.id);
  }

  @Patch(":id/status")
  updateStatus(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() input: UpdateTicketStatusDto,
    @CurrentOrganization() organization: AuthenticatedOrganization,
  ) {
    return this.ticketsService.updateTicketStatus(id, organization.id, input);
  }
}
