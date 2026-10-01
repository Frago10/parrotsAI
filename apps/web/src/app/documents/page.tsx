import { getLocale } from 'next-intl/server';
import { createDocumentAction, deleteDocumentAction } from './actions';
import { LibraryPage } from '@/components/library/LibraryPage';
import { currentUser, prisma } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DocumentsPage() {
  const user = await currentUser();
  const locale = await getLocale();
  const docs = await prisma.document.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  const es = locale !== 'en';
  return (
    <LibraryPage
      title="Documents"
      subtitle={
        es
          ? 'Briefs, playbooks y material de apoyo que la IA usa durante la llamada.'
          : 'Briefs, playbooks and support material the AI uses during the call.'
      }
      items={docs.map((d) => ({
        id: d.id,
        title: d.title,
        meta: `${formatDate(d.createdAt, locale)} · ${d.mimeType} · ${d.sizeBytes} bytes · ${d.status}`,
        preview: d.text.slice(0, 400),
      }))}
      createAction={createDocumentAction}
      deleteAction={deleteDocumentAction}
      labels={{
        add: es ? 'Añadir documento' : 'Add document',
        name: es ? 'Título' : 'Title',
        file: es
          ? 'Archivo (.txt o .md; PDF/DOCX en la fase 7)'
          : 'File (.txt or .md; PDF/DOCX in phase 7)',
        text: es ? 'O pega el texto' : 'Or paste the text',
        delete: es ? 'Eliminar' : 'Delete',
        empty: es ? 'Todavía no hay documentos.' : 'No documents yet.',
      }}
    />
  );
}
