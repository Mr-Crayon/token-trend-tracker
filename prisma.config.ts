import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Migrations need Neon's direct (unpooled) connection. The Neon + Vercel
    // integration names it DATABASE_URL_UNPOOLED. Left optional so
    // `prisma generate` still works during builds without it.
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
  },
});
