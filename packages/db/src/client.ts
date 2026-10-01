// Cliente Prisma único por proceso (driver adapter pg). Se crea de forma perezosa para que
// importar el módulo no falle antes de cargar .env; en dev se guarda en globalThis para
// sobrevivir al hot reload de Next.js.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const globalForPrisma = globalThis as unknown as { __callpilotPrisma?: PrismaClient };

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL no está definida. Copia .env.example a .env en la raíz del repo.',
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__callpilotPrisma) globalForPrisma.__callpilotPrisma = createPrismaClient();
  return globalForPrisma.__callpilotPrisma;
}

/** Acceso perezoso: `prisma.user.findMany()` crea el cliente en el primer uso. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
