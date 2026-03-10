'use client';

import { useState, useCallback } from 'react';
import { ThumbsUp, ThumbsDown, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useConversationStore } from '@/store/conversation';
import { api } from '@/lib/api';

interface MessageFeedbackProps {
  conversationId: string;
  messageSeq: number;
}

export function MessageFeedback({ conversationId, messageSeq }: MessageFeedbackProps) {
  const feedbackByMessage = useConversationStore((s) => s.feedbackByMessage);
  const setFeedback = useConversationStore((s) => s.setFeedback);
  const existing = feedbackByMessage[`${conversationId}:${messageSeq}`];

  const [submitting, setSubmitting] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');

  const submit = useCallback(
    async (rating: 'positive' | 'negative', commentText?: string) => {
      setSubmitting(true);
      try {
        await api.feedback.submit(conversationId, messageSeq, {
          rating,
          comment: commentText || undefined,
        });
        setFeedback(conversationId, messageSeq, rating);
        setShowComment(false);
        setComment('');
      } catch {
        // Silently fail — feedback is best-effort
      } finally {
        setSubmitting(false);
      }
    },
    [conversationId, messageSeq, setFeedback],
  );

  const handleThumbsUp = useCallback(() => {
    if (existing || submitting) return;
    submit('positive');
  }, [existing, submitting, submit]);

  const handleThumbsDown = useCallback(() => {
    if (existing || submitting) return;
    setShowComment(true);
  }, [existing, submitting]);

  const handleCommentSubmit = useCallback(() => {
    submit('negative', comment);
  }, [submit, comment]);

  const handleCommentSkip = useCallback(() => {
    submit('negative');
  }, [submit]);

  if (existing) {
    return (
      <div className="flex items-center gap-1 pt-1">
        <span className="text-xs text-muted-foreground">
          {existing === 'positive' ? (
            <ThumbsUp className="inline size-3.5 text-emerald-500" />
          ) : (
            <ThumbsDown className="inline size-3.5 text-red-400" />
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="pt-1">
      <div className="flex items-center gap-0.5">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-emerald-500"
                onClick={handleThumbsUp}
                disabled={submitting}
              >
                {submitting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ThumbsUp className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Good response</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-red-400"
                onClick={handleThumbsDown}
                disabled={submitting}
              >
                <ThumbsDown className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Bad response</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {showComment && (
        <div className="mt-2 flex max-w-sm gap-2">
          <textarea
            className="flex-1 resize-none rounded-md border bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            rows={2}
            placeholder="What went wrong? (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleCommentSubmit();
              }
            }}
          />
          <div className="flex flex-col gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={handleCommentSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-1 py-0.5 text-[10px] text-muted-foreground"
              onClick={handleCommentSkip}
              disabled={submitting}
            >
              Skip
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
