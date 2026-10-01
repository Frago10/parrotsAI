import type { RealtimeConfig } from '../config';
import { DeepgramSttProvider } from './deepgram';
import { FakeSttProvider } from './fake';
import type { SttProvider } from './types';

export * from './types';
export { FakeSttProvider } from './fake';
export { DeepgramSttProvider } from './deepgram';

export function createSttProvider(
  cfg: Pick<RealtimeConfig, 'sttProvider' | 'deepgramApiKey'>,
): SttProvider {
  if (cfg.sttProvider === 'deepgram' && cfg.deepgramApiKey)
    return new DeepgramSttProvider(cfg.deepgramApiKey);
  return new FakeSttProvider();
}
