export { prisma, createPrismaClient, getPrisma } from './client';
export type { PrismaClient } from '../generated/prisma/client';
export * from '../generated/prisma/client';
export { DEFAULT_USER_EMAIL, ensureDefaultUser } from './defaultUser';
