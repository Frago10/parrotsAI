// Captura de audio en el navegador: pestaña (canal "them") y micrófono (canal "me").
// Todo se remuestrea a 16 kHz mono PCM16 vía AudioWorklet. Lo usan la web y la extensión.
import { AUDIO_SAMPLE_RATE, type AudioChannel } from '@callpilot/shared';

export class NoAudioTrackError extends Error {
  constructor() {
    super('La pestaña compartida no incluye audio');
    this.name = 'NoAudioTrackError';
  }
}

export interface AudioCaptureHandlers {
  onChunk: (channel: AudioChannel, pcm: Int16Array) => void;
  onLevel: (channel: AudioChannel, level: number) => void;
  onTabEnded: () => void;
  /** Ruta del worklet dentro de la app. Por defecto /worklets/pcm-processor.js. */
  workletUrl?: string;
}

interface ChannelNodes {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
}

export function isTabAudioSupported(): boolean {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) return false;
  const ua = navigator.userAgent;
  const isChromium = /Chrome\/|Chromium\/|Edg\//.test(ua) && !/Mobile/.test(ua);
  return isChromium && typeof AudioWorkletNode !== 'undefined';
}

export class AudioCapture {
  private ctx: AudioContext | null = null;
  private playbackCtx: AudioContext | null = null;
  private playbackNodes: Partial<Record<AudioChannel, MediaStreamAudioSourceNode>> = {};
  private channels: Partial<Record<AudioChannel, ChannelNodes>> = {};
  private workletLoaded = false;
  /** Pista de video de la pestaña compartida, en memoria solo para la función Screenshot. */
  videoTrack: MediaStreamTrack | null = null;

  constructor(private readonly handlers: AudioCaptureHandlers) {}

  private async context(): Promise<AudioContext> {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.workletLoaded) {
      await this.ctx.audioWorklet.addModule(
        this.handlers.workletUrl ?? '/worklets/pcm-processor.js',
      );
      this.workletLoaded = true;
    }
    return this.ctx;
  }

  /**
   * Conecta un stream de audio a un canal. Con `passthrough` el audio también se reproduce:
   * capturar una pestaña con tabCapture la silencia para el usuario si no se devuelve a los altavoces.
   */
  async attach(
    channel: AudioChannel,
    stream: MediaStream,
    opts: { passthrough?: boolean } = {},
  ): Promise<void> {
    this.detach(channel);
    const ctx = await this.context();
    const audioOnly = new MediaStream(stream.getAudioTracks());
    const source = ctx.createMediaStreamSource(audioOnly);
    const node = new AudioWorkletNode(ctx, 'pcm-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { chunkSize: 640 },
    });
    node.port.onmessage = (
      ev: MessageEvent<{ type: 'chunk'; pcm: ArrayBuffer } | { type: 'level'; level: number }>,
    ) => {
      if (ev.data.type === 'chunk') this.handlers.onChunk(channel, new Int16Array(ev.data.pcm));
      else this.handlers.onLevel(channel, ev.data.level);
    };
    source.connect(node);
    this.channels[channel] = { stream, source, node };
    if (opts.passthrough) {
      this.playbackCtx ??= new AudioContext();
      const playSource = this.playbackCtx.createMediaStreamSource(audioOnly);
      playSource.connect(this.playbackCtx.destination);
      this.playbackNodes[channel] = playSource;
    }
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (channel === 'them') this.handlers.onTabEnded();
    });
  }

  private detach(channel: AudioChannel): void {
    const c = this.channels[channel];
    try {
      this.playbackNodes[channel]?.disconnect();
    } catch {
      /* ya desconectado */
    }
    delete this.playbackNodes[channel];
    if (!c) return;
    try {
      c.source.disconnect();
      c.node.port.onmessage = null;
      c.node.disconnect();
    } catch {
      /* ya desconectado */
    }
    for (const t of c.stream.getTracks()) t.stop();
    delete this.channels[channel];
  }

  /** Pide compartir la pestaña de la llamada con audio. Lanza NoAudioTrackError si no hay audio. */
  async startTab(): Promise<void> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { suppressLocalAudioPlayback: false } as MediaTrackConstraints,
      // Opciones específicas de Chrome: no están en los tipos estándar.
      ...({
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        systemAudio: 'include',
        surfaceSwitching: 'include',
      } as object),
    });
    if (!stream.getAudioTracks().length) {
      for (const t of stream.getTracks()) t.stop();
      throw new NoAudioTrackError();
    }
    this.videoTrack = stream.getVideoTracks()[0] ?? null;
    this.videoTrack?.addEventListener('ended', () => this.handlers.onTabEnded());
    await this.attach('them', stream);
  }

  /**
   * Audio de una pestaña a partir de un stream id de chrome.tabCapture (solo extensiones).
   * El id lo emite el service worker tras una invocación del usuario (atajo o menú contextual).
   */
  async startTabFromStreamId(streamId: string): Promise<void> {
    const constraints = {
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false,
    } as unknown as MediaStreamConstraints;
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (!stream.getAudioTracks().length) {
      for (const t of stream.getTracks()) t.stop();
      throw new NoAudioTrackError();
    }
    await this.attach('them', stream, { passthrough: true });
  }

  /** Micrófono del usuario (canal "me"). */
  async startMic(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    await this.attach('me', stream);
  }

  /** Reinicia la captura de pestaña sin cortar la sesión. */
  async changeTab(): Promise<void> {
    await this.startTab();
  }

  stopChannel(channel: AudioChannel): void {
    this.detach(channel);
    if (channel === 'them') this.videoTrack = null;
  }

  get hasTab(): boolean {
    return Boolean(this.channels.them);
  }
  get hasMic(): boolean {
    return Boolean(this.channels.me);
  }

  /** Captura un frame de la pestaña compartida como WebP (máx. 1600 px). */
  async grabFrame(): Promise<Blob | null> {
    if (!this.videoTrack || this.videoTrack.readyState !== 'live') return null;
    const video = document.createElement('video');
    video.srcObject = new MediaStream([this.videoTrack]);
    video.muted = true;
    await video.play();
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();
    video.srcObject = null;
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
  }

  stop(): void {
    this.detach('them');
    this.detach('me');
    this.videoTrack = null;
    void this.ctx?.close();
    void this.playbackCtx?.close();
    this.ctx = null;
    this.playbackCtx = null;
    this.workletLoaded = false;
  }
}
