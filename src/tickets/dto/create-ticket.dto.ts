import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export class CreateTicketDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  customerEmail?: string;

  /** Snake-case alias accepted for clients that mirror the database schema. */
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  customer_email?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(/\S/, { message: "subject must contain a non-whitespace character" })
  subject!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  @Matches(/\S/, { message: "message must contain a non-whitespace character" })
  message!: string;
}
