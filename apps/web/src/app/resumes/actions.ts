'use server';

import { revalidatePath } from 'next/cache';
import { currentUser, prisma } from '@/lib/db';
import { readTextUpload } from '@/lib/upload';

export async function createResumeAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  const title = String(formData.get('title') ?? '').trim() || 'CV';
  const text = await readTextUpload(formData);
  const isDefault = formData.get('isDefault') === 'on';
  if (isDefault)
    await prisma.resume.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
  await prisma.resume.create({ data: { userId: user.id, title, parsedText: text, isDefault } });
  revalidatePath('/resumes');
}

export async function deleteResumeAction(id: string): Promise<void> {
  await prisma.resume.delete({ where: { id } });
  revalidatePath('/resumes');
}

export async function setDefaultResumeAction(id: string): Promise<void> {
  const user = await currentUser();
  await prisma.$transaction([
    prisma.resume.updateMany({ where: { userId: user.id }, data: { isDefault: false } }),
    prisma.resume.update({ where: { id }, data: { isDefault: true } }),
  ]);
  revalidatePath('/resumes');
}
