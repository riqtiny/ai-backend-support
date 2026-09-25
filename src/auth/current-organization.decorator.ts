import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import {
  AuthenticatedOrganization,
  AuthenticatedRequest,
} from "./authenticated-request";

export const CurrentOrganization = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedOrganization =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().organization,
);
