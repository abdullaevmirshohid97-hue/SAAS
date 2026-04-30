import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, MessageSquare, CheckCircle2, Clock, Loader2, Send } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  helpful_count: number;
  reply_text: string | null;
  replied_at: string | null;
  is_verified: boolean;
  created_at: string;
  portal_user_id: string;
}

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`h-4 w-4 ${s <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`}
        />
      ))}
    </div>
  );
}

function ReviewCard({ review, onReply }: { review: Review; onReply: (id: string, text: string) => void }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState(review.reply_text ?? '');

  return (
    <div className="rounded-2xl border bg-card shadow-sm p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
            {review.portal_user_id.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <StarDisplay rating={review.rating} />
              {review.is_verified && (
                <span className="flex items-center gap-0.5 text-xs text-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  Tasdiqlangan
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
            </p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">{review.helpful_count} foydali</span>
      </div>

      {/* Comment */}
      {review.comment && (
        <p className="text-sm text-foreground">{review.comment}</p>
      )}

      {/* Existing reply */}
      {review.reply_text && !replyOpen && (
        <div className="flex gap-2 bg-muted/40 rounded-xl p-3">
          <div className="h-1.5 w-1.5 rounded-full bg-primary mt-2 shrink-0" />
          <div>
            <p className="text-xs font-medium text-primary mb-1">Klinika javobi</p>
            <p className="text-sm">{review.reply_text}</p>
          </div>
        </div>
      )}

      {/* Reply action */}
      {!replyOpen ? (
        <button
          onClick={() => setReplyOpen(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {review.reply_text ? 'Javobni tahrirlash' : 'Javob berish'}
        </button>
      ) : (
        <div className="space-y-2">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Izohga javob yozing..."
            rows={3}
            className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { onReply(review.id, replyText); setReplyOpen(false); }}
              disabled={!replyText.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Send className="h-3 w-3" />
              Yuborish
            </button>
            <button
              onClick={() => { setReplyOpen(false); setReplyText(review.reply_text ?? ''); }}
              className="rounded-lg border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
            >
              Bekor
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReviewsPage() {
  const { clinicId } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unanswered' | 'answered'>('all');

  const { data: reviews, isLoading } = useQuery({
    queryKey: ['clinic-reviews', clinicId],
    queryFn: async () => {
      if (!clinicId) return [];
      const { data, error } = await supabase
        .from('clinic_reviews')
        .select('id,rating,comment,helpful_count,reply_text,replied_at,is_verified,created_at,portal_user_id')
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Review[];
    },
    enabled: !!clinicId,
  });

  const { mutate: reply } = useMutation({
    mutationFn: async ({ reviewId, text }: { reviewId: string; text: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: profile } = await supabase
        .from('profiles').select('id').eq('user_id', session?.user.id).eq('clinic_id', clinicId).maybeSingle();

      const { error } = await supabase
        .from('clinic_reviews')
        .update({ reply_text: text, replied_at: new Date().toISOString(), replied_by: profile?.id })
        .eq('id', reviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Javob yuborildi');
      qc.invalidateQueries({ queryKey: ['clinic-reviews', clinicId] });
    },
    onError: () => toast.error('Xatolik yuz berdi'),
  });

  const filtered = (reviews ?? []).filter((r) => {
    if (filter === 'unanswered') return !r.reply_text;
    if (filter === 'answered') return !!r.reply_text;
    return true;
  });

  const avgRating = reviews?.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Izohlar</h2>
          <p className="text-sm text-muted-foreground">Axolidan kelgan izohlar va reytinglar</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border bg-card p-4 text-center">
          <p className="text-3xl font-black text-amber-500">{avgRating ?? '—'}</p>
          <div className="flex justify-center my-1">
            {avgRating && <StarDisplay rating={Math.round(Number(avgRating))} />}
          </div>
          <p className="text-xs text-muted-foreground">O'rtacha reyting</p>
        </div>
        <div className="rounded-2xl border bg-card p-4 text-center">
          <p className="text-3xl font-black text-foreground">{reviews?.length ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">Jami izoh</p>
        </div>
        <div className="rounded-2xl border bg-card p-4 text-center">
          <p className="text-3xl font-black text-amber-600">
            {reviews?.filter((r) => !r.reply_text).length ?? 0}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Javob kutmoqda</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-xl bg-muted/40 p-1 w-fit">
        {(['all', 'unanswered', 'answered'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {f === 'all' ? 'Barchasi' : f === 'unanswered' ? 'Javob kutmoqda' : 'Javob berilgan'}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>Izoh topilmadi</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <ReviewCard
              key={r.id}
              review={r}
              onReply={(id, text) => reply({ reviewId: id, text })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
