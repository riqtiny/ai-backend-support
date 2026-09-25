import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedRequest } from "./authenticated-request";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const apiKey = request.get("x-api-key")?.trim();

    if (!apiKey || apiKey.length > 255) {
      throw new UnauthorizedException("A valid x-api-key header is required");
    }

    const organization = await this.prisma.organization.findUnique({
      where: { apiKey },
      select: { id: true, name: true },
    });

    if (!organization) {
      throw new UnauthorizedException("A valid x-api-key header is required");
    }

    request.organization = organization;
    return true;
  }
}
