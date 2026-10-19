// Utilidades de imagen para el lector de pantalla: reducir una captura y convertirla a base64.

export interface EncodedImage {
  base64: string;
  mediaType: 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  bytes: number;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Reduce una imagen a `maxSide` píxeles por el lado largo y la recodifica (JPEG por defecto).
 * Funciona en páginas con DOM y en workers (usa OffscreenCanvas cuando existe).
 */
export async function downscaleImage(
  source: Blob,
  opts: { maxSide?: number; quality?: number; type?: 'image/jpeg' | 'image/webp' } = {},
): Promise<EncodedImage> {
  const maxSide = opts.maxSide ?? 1568;
  const quality = opts.quality ?? 0.8;
  const type = opts.type ?? 'image/jpeg';
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  let out: Blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    out = await canvas.convertToBlob({ type, quality });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    out = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('no se pudo codificar la imagen'))),
        type,
        quality,
      ),
    );
  }
  bitmap.close();
  return { base64: await blobToBase64(out), mediaType: type, width, height, bytes: out.size };
}
