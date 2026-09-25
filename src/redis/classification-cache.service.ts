import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { TicketClassificationResult } from "../tickets/ticket.types";
import {
  calculateTicketSimilarity,
  CLASSIFICATION_CACHE_PREFIX,
  ClassificationCacheEntry,
  isClassificationCacheEntry,
  ticketCacheKey,
} from "./classification-cache.util";

@Injectable()
export class ClassificationCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(ClassificationCacheService.name);
  private readonly enabled: boolean;
  private readonly ttlSeconds: number;
  private readonly similarityThreshold: number;
  private readonly maxSimilarEntries: number;
  private client: Redis | null = null;
  private connectionPromise: Promise<Redis | null> | null = null;

  constructor(private readonly config: ConfigService) {
    this.enabled = !["false", "0", "off", "no"].includes(
      this.config.get<string>("REDIS_ENABLED", "true").toLowerCase(),
    );
    this.ttlSeconds = this.readInteger("CACHE_TTL_SECONDS", 604_800, 1);
    this.similarityThreshold = this.readThreshold(
      "CACHE_SIMILARITY_THRESHOLD",
      0.85,
    );
    this.maxSimilarEntries = this.readInteger(
      "CACHE_SIMILARITY_MAX_ENTRIES",
      100,
      0,
    );

    if (this.enabled) {
      this.client = this.createClient();
    }
  }

  async get(
    organizationId: string,
    subject: string,
    message: string,
  ): Promise<TicketClassificationResult | null> {
    try {
      const client = await this.getClient();
      if (!client) {
        return null;
      }

      const keyPrefix = this.keyPrefix(organizationId);
      const exactKey = ticketCacheKey(organizationId, subject, message);
      const exact = this.parseEntry(await client.get(exactKey));
      if (exact) {
        return this.toResult(exact);
      }

      if (this.maxSimilarEntries === 0) {
        return null;
      }

      let cursor = "0";
      let inspected = 0;

      do {
        const [nextCursor, keys] = await client.scan(
          cursor,
          "MATCH",
          `${keyPrefix}:*`,
          "COUNT",
          50,
        );
        cursor = String(nextCursor);

        const remaining = this.maxSimilarEntries - inspected;
        if (remaining > 0 && keys.length > 0) {
          const selectedKeys = keys.slice(0, remaining);
          const values = await client.mget(...selectedKeys);
          inspected += selectedKeys.length;

          for (const value of values) {
            const entry = this.parseEntry(value);
            if (
              entry &&
              calculateTicketSimilarity(
                entry.subject,
                entry.message,
                subject,
                message,
              ) >= this.similarityThreshold
            ) {
              return this.toResult(entry);
            }
          }
        }
      } while (cursor !== "0" && inspected < this.maxSimilarEntries);

      return null;
    } catch (error) {
      this.logger.warn(
        `Classification cache read failed: ${this.errorMessage(error)}`,
      );
      return null;
    }
  }

  async set(
    organizationId: string,
    subject: string,
    message: string,
    result: TicketClassificationResult,
  ): Promise<void> {
    try {
      const client = await this.getClient();
      if (!client) {
        return;
      }

      const entry: ClassificationCacheEntry = {
        subject,
        message,
        category: result.category,
        suggestedReply: result.suggestedReply,
      };

      await client.set(
        ticketCacheKey(organizationId, subject, message),
        JSON.stringify(entry),
        "EX",
        this.ttlSeconds,
      );
    } catch (error) {
      this.logger.warn(
        `Classification cache write failed: ${this.errorMessage(error)}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
    this.client = null;
  }

  private keyPrefix(organizationId: string): string {
    return `${CLASSIFICATION_CACHE_PREFIX}:${encodeURIComponent(organizationId)}`;
  }

  private parseEntry(raw: string | null): ClassificationCacheEntry | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      return isClassificationCacheEntry(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private toResult(
    entry: ClassificationCacheEntry,
  ): TicketClassificationResult {
    return {
      category: entry.category,
      suggestedReply: entry.suggestedReply,
    };
  }

  private createClient(): Redis {
    const client = new Redis(
      this.config.get<string>("REDIS_URL", "redis://localhost:6379"),
      {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 1_000,
        retryStrategy: () => null,
      },
    );

    client.on("error", (error: Error) => {
      this.logger.warn(`Redis connection error: ${error.message}`);
    });
    return client;
  }

  private async getClient(): Promise<Redis | null> {
    if (!this.enabled) {
      return null;
    }

    if (!this.client) {
      this.client = this.createClient();
    }
    if (this.client.status === "ready") {
      return this.client;
    }
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    const candidate = this.client;
    this.connectionPromise = this.connect(candidate).finally(() => {
      this.connectionPromise = null;
    });
    return this.connectionPromise;
  }

  private async connect(candidate: Redis): Promise<Redis | null> {
    try {
      if (candidate.status === "end") {
        candidate.disconnect();
        this.client = this.createClient();
        return this.connect(this.client);
      }

      await candidate.connect();
      return candidate.status === "ready" ? candidate : null;
    } catch (error) {
      this.logger.warn(
        `Redis connection could not be established: ${this.errorMessage(error)}`,
      );
      if (this.client === candidate) {
        this.client = this.createClient();
      }
      return null;
    }
  }

  private readInteger(name: string, fallback: number, minimum: number): number {
    const value = Number(this.config.get<string | number>(name, fallback));
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return Math.max(minimum, Math.floor(value));
  }

  private readThreshold(name: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(name, fallback));
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return Math.min(1, Math.max(0, value));
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
