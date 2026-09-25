import { Global, Module } from "@nestjs/common";
import { ClassificationCacheService } from "./classification-cache.service";

@Global()
@Module({
  providers: [ClassificationCacheService],
  exports: [ClassificationCacheService],
})
export class RedisModule {}
