// Sin autenticación en el MVP personal: existe un único usuario local.
import type { PrismaClient } from '../generated/prisma/client';

export const DEFAULT_USER_EMAIL = 'local@callpilot.dev';

export async function ensureDefaultUser(client: PrismaClient) {
  return client.user.upsert({
    where: { email: DEFAULT_USER_EMAIL },
    update: {},
    create: { email: DEFAULT_USER_EMAIL, name: 'Usuario local', plan: 'FREE', creditsBalance: 10 },
  });
}
