import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Lazily created so builds don't need DATABASE_URL. */
export function db(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const client = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
  globalForPrisma.prisma = client;
  return client;
}
