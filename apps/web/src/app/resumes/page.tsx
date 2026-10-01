import { getLocale } from 'next-intl/server';
import { createResumeAction, deleteResumeAction, setDefaultResumeAction } from './actions';
import { LibraryPage } from '@/components/library/LibraryPage';
import { currentUser, prisma } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ResumesPage() {
  const user = await currentUser();
  const locale = await getLocale();
  const resumes = await prisma.resume.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  const es = locale !== 'en';
  return (
    <LibraryPage
      title="Resumes"
      subtitle={
        es
          ? 'Tus CVs. El CV seleccionado se usa en las sesiones en modo Entrevista.'
          : 'Your resumes. The selected resume is used in Interview sessions.'
      }
      items={resumes.map((r) => ({
        id: r.id,
        title: r.title,
        meta: `${formatDate(r.createdAt, locale)} · ${r.parsedText.length} chars`,
        isDefault: r.isDefault,
        preview: r.parsedText.slice(0, 400),
      }))}
      createAction={createResumeAction}
      deleteAction={deleteResumeAction}
      setDefaultAction={setDefaultResumeAction}
      labels={{
        add: es ? 'Añadir CV' : 'Add resume',
        name: es ? 'Título' : 'Title',
        file: es
          ? 'Archivo (.txt o .md; PDF/DOCX en la fase 7)'
          : 'File (.txt or .md; PDF/DOCX in phase 7)',
        text: es ? 'O pega el texto del CV' : 'Or paste the resume text',
        isDefault: es ? 'Usar por defecto' : 'Use as default',
        delete: es ? 'Eliminar' : 'Delete',
        setDefault: es ? 'Hacer default' : 'Set default',
        empty: es ? 'Todavía no hay CVs.' : 'No resumes yet.',
      }}
    />
  );
}
