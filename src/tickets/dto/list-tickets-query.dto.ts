import { IsIn, IsOptional } from "class-validator";
import {
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  TicketCategory,
  TicketStatusValue,
} from "../ticket.types";

export class ListTicketsQueryDto {
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: TicketStatusValue;

  @IsOptional()
  @IsIn(TICKET_CATEGORIES)
  category?: TicketCategory;
}
