import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Las variables viven en el .env de la raíz del monorepo.
loadEnv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@callpilot/shared', '@callpilot/ai', '@callpilot/db'],
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg', '@anthropic-ai/sdk'],
  typescript: { ignoreBuildErrors: false },
  agentRules: false,
};

export default withNextIntl(nextConfig);
