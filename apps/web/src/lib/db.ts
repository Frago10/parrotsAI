// Acceso a datos desde Next.js (servidor). Un único usuario local en el MVP.
import { prisma, ensureDefaultUser, DEFAULT_USER_EMAIL } from '@callpilot/db';

export { prisma };

export async function currentUser() {
  const user = await prisma.user.findUnique({ where: { email: DEFAULT_USER_EMAIL } });
  return user ?? ensureDefaultUser(prisma);
}
