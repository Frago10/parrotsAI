// Abstracción de STT en streaming. Una conexión por canal (me/them) para "diarizar" por fuente.
export interface SttStreamOptions {
  language: string;
  sampleRate: number;
  /** Términos a reforzar (empresa, producto, nombres). */
  keyterms: string[];
}

export interface SttPartialEvent {
  text: string;
  startMs: number;
  endMs: number;
}

export interface SttFinalEvent extends SttPartialEvent {
  confidence: number | null;
  language: string | null;
}

export interface SttStreamHandlers {
  onOpen?: () => void;
  onPartial: (ev: SttPartialEvent) => void;
  onFinal: (ev: SttFinalEvent) => void;
  onUtteranceEnd: () => void;
  onError: (err: Error) => void;
  onClose?: () => void;
}

export interface SttStream {
  /** Envía PCM16LE mono. */
  send(pcm: Uint8Array): void;
  /** Cierra la conexión y libera recursos. */
  close(): Promise<void>;
  /** Solo en proveedores simulados: inyecta texto como si viniera del audio. */
  inject?(text: string, isFinal: boolean): void;
}

export interface SttProvider {
  readonly id: string;
  open(opts: SttStreamOptions, handlers: SttStreamHandlers): Promise<SttStream>;
}
