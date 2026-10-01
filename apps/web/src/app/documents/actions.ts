'use server';

import { revalidatePath } from 'next/cache';
import { currentUser, prisma } from '@/lib/db';
import { readTextUpload } from '@/lib/upload';

export async function createDocumentAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  const file = formData.get('file');
  const title =
    String(formData.get('title') ?? '').trim() || (file instanceof File ? file.name : 'Documento');
  const text = await readTextUpload(formData);
  const mimeType = file instanceof File && file.type ? file.type : 'text/plain';
  await prisma.document.create({
    data: {
      userId: user.id,
      title,
      mimeType,
      sizeBytes: text.length,
      status: text ? 'READY' : 'FAILED',
      text,
    },
  });
  revalidatePath('/documents');
}

export async function deleteDocumentAction(id: string): Promise<void> {
  await prisma.document.delete({ where: { id } });
  revalidatePath('/documents');
}
