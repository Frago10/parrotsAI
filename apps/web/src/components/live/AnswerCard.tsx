'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { formatClock } from '@callpilot/shared';
import { Markdown } from '@/components/Markdown';
import type { UiAnswer } from '@/hooks/useLiveSession';

export function AnswerCard({
  answer,
  onFeedback,
  onPin,
  compact,
}: {
  answer: UiAnswer;
  onFeedback: (id: string, v: 'up' | 'down') => void;
  onPin: (id: string) => void;
  compact: boolean;
}) {
  const t = useTranslations('live');
  const [copied, setCopied] = useState(false);
  const isUser = answer.kind === 'CHAT_USER';
  const label = isUser ? 'You' : answer.kind === 'CHAT_AI' ? 'Chat' : 'Answer';

  function copy() {
    void navigator.clipboard?.writeText(answer.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <div
      className={`card ${compact ? 'p-2' : 'p-3'} ${isUser ? 'border-dashed' : ''} ${answer.pinned ? 'border-accent' : ''}`}
    >
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span>
          {label} · {formatClock(answer.sessionMs)}
          {answer.streaming && (
            <span className="pulse-dot ml-2 inline-block h-2 w-2 rounded-full bg-accent" />
          )}
          {answer.latencyMs != null && !compact && (
            <span className="ml-2 opacity-70">
              {answer.firstTokenMs != null ? `${answer.firstTokenMs} ms` : ''} / {answer.latencyMs}{' '}
              ms
            </span>
          )}
        </span>
        {!isUser && (
          <span className="flex gap-1">
            <button className="hover:text-text" onClick={copy} title={t('copy')}>
              {copied ? '✓' : '⧉'}
            </button>
            <button
              className={`hover:text-text ${answer.pinned ? 'text-accent' : ''}`}
              onClick={() => onPin(answer.id)}
              title={t('pin')}
            >
              📌
            </button>
            <button
              className={`hover:text-text ${answer.feedback === 'up' ? 'text-success' : ''}`}
              onClick={() => onFeedback(answer.id, 'up')}
            >
              👍
            </button>
            <button
              className={`hover:text-text ${answer.feedback === 'down' ? 'text-danger' : ''}`}
              onClick={() => onFeedback(answer.id, 'down')}
            >
              👎
            </button>
          </span>
        )}
      </div>
      {answer.error ? (
        <div className="text-sm text-danger">{answer.error}</div>
      ) : isUser ? (
        <div className="text-sm">{answer.content}</div>
      ) : (
        <Markdown text={answer.content} className="text-sm" />
      )}
    </div>
  );
}
