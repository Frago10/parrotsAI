import { describe, expect, it } from 'vitest';
import { decodeAudioFrame, encodeAudioFrame, parseClientMessage, parseServerMessage } from '../protocol';

describe('protocolo', () => {
  it('codifica y decodifica frames de audio', () => {
    const pcm = new Int16Array([1, -1, 32767]);
    const frame = encodeAudioFrame('them', pcm);
    expect(frame[0]).toBe(1);
    const decoded = decodeAudioFrame(frame)!;
    expect(decoded.channel).toBe('them');
    expect(decoded.pcm.byteLength).toBe(6);
  });
  it('rechaza mensajes inválidos', () => {
    expect(parseClientMessage('{"type":"nope"}')).toBeNull();
    expect(parseClientMessage('no json')).toBeNull();
    expect(parseClientMessage('{"type":"chat.send","text":"hola"}')).toEqual({ type: 'chat.send', text: 'hola' });
    expect(parseServerMessage('{"type":"panel.cleared"}')).toEqual({ type: 'panel.cleared' });
  });
});
