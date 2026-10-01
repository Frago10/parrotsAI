// Configuración de Prisma 7. La URL de la base viene de DATABASE_URL (raíz del repo o del paquete).
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

loadEnv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
loadEnv({ path: path.resolve(process.cwd(), '.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:5432/callpilot',
  },
});
