// Lectura de texto desde un formulario: archivo .txt/.md o texto pegado.
// PDF y DOCX se incorporan en la fase de documentos/RAG (fase 7).
const MAX_BYTES = 20 * 1024 * 1024;

export async function readTextUpload(formData: FormData): Promise<string> {
  const pasted = String(formData.get('text') ?? '').trim();
  const file = formData.get('file');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) throw new Error('El archivo supera 20 MB');
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf') || name.endsWith('.docx')) {
      throw new Error(
        'PDF y DOCX se soportan en la fase de RAG; por ahora sube .txt/.md o pega el texto.',
      );
    }
    const text = (await file.text()).trim();
    if (text) return text;
  }
  return pasted;
}
