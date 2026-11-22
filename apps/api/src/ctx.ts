import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Database, Queryable } from "@salon/db";
import type { Ai } from "./ai";
import type { TelegramClient } from "./telegram";

import type { ClientSession, StaffSession } from "./session";

declare module "fastify" {
  interface FastifyRequest {
    staff: StaffSession | null;
    client: ClientSession | null;
  }
}

export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

/** Общие зависимости модулей API. Собирается один раз в buildApp. */
export interface Ctx {
  app: FastifyInstance;
  db: Database;
  secret: string;
  now: () => Date;
  sms: SmsSender;
  telegram: TelegramClient | null;
  ai: Ai;
  inSalon: <T>(salonId: string, run: (q: Queryable) => Promise<T>) => Promise<T>;
  /** preHandler-ы по ролям. */
  guards: {
    admins: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    owner: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    anyStaff: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    client: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  };
}
