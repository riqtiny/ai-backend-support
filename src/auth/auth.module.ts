import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ApiKeyGuard } from "./api-key.guard";

@Module({
  imports: [PrismaModule],
  providers: [ApiKeyGuard],
  exports: [ApiKeyGuard],
})
export class AuthModule {}
