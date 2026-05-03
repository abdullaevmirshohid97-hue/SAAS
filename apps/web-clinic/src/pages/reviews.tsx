import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Star, MessageSquare, CheckCircle2, Clock, Loader2, Send, Eye, EyeOff, TrendingUp,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import { cn } from '@clary/ui-web';
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
  is_hidden: boolean;
  created_at: string;
  portal_user_id: string;
}

function StarDisplay({ rating, size = 4 }: { rating: number; size?: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={cn(`h-${size} w-${size}`, s <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30')}
        />
      ))}
    </div>
  );
}

function ReviewCard({
  review, onReply, onToggleHide,
}: {
  review: Review;
  onReply: (id: string, text: string) => void;
  onToggleHide: (id: string, hide: boolean) => void;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState(review.reply_text ?? '');

  return (
    <div className={cn('rounded-2xl border bg-card p-4 space-y-3 shadow-sm', review.is_hidden && 'opacity-60')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {review.portal_user_id.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <StarDisplay rating={review.rating} />
              {review.is_verified && (
                <span className="flex items-center gap-0.5 text-xs text-emerald-600">
                  <CheckCircle2 className="h-3 w-3" /> Tasdiqlangan
                </span>
              )}
              {review.is_hidden && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">YASHIRIN</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{review.helpful_count} foydali</span>
          <button
            onClick={() => onToggleHide(review.id, !review.is_hidden)}
            title={review.is_hidden ? "Ko'rsatish" : 'Yashirish'}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {review.is_hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {review.comment && <p className="text-sm">{review.comment}</p>}

      {review.reply_text && !replyOpen && (
        <div className="flex gap-2 rounded-xl bg-muted/40 p-3">
          <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <div>
            <p className="mb-1 text-xs font-medium text-primary">Klinika javobi</p>
            <p className="text-sm">{review.reply_text}</p>
            {review.replied_at && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                <Clock className="inline h-2.5 w-2.5" /> {formatDistanceToNow(new Date(review.replied_at), { addSuffix: true })}
              </p>
            )}
          </div>
        </div>
      )}

      {!replyOpen ? (
        <button
          onClick={() => setReplyOpen(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
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
            className="w-full resize-none rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { onReply(review.id, replyText); setReplyOpen(false); }}
              disabled={!replyText.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-3 w-3" /> Yuborish
            </button>
            <button
              onClick={() => { setReplyOpen(false); setReplyText(review.reply_text ?? ''); }}
              className="rounded-lg border px-3 py-1.5 text-xs hover:bg-muted"
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
  const [filter, setFilter] = useState<'all' | 'unanswered' | 'answered' | 'hidden'>('all');
  const [ratingFilter, setRatingFilter] = useState<number | null>(null);

  const { data: reviews, isLoading } = useQuery({
    queryKey: ['clinic-reviews', clinicId],
    queryFn: async () => {
      if (!clinicId) return [];
      const { data, error } = await supabase
        .from('clinic_reviews')
        .select('id,rating,comment,helpful_count,reply_text,replied_at,is_verified,is_hidden,created_at,portal_user_id')
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
    onSuccess: () => { toast.success('Javob yuborildi'); qc.invalidateQueries({ queryKey: ['clinic-reviews', clinicId] }); },
    onError: () => toast.error('Xatolik yuz berdi'),
  });

  const { mutate: toggleHide } = useMutation({
    mutationFn: async ({ id, hide }: { id: string; hide: boolean }) => {
      const { error } = await supabase.from('clinic_reviews').update({ is_hidden: hide }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      toast.success(vars.hide ? 'Sharh yashirildi' : "Sharh ko'rsatildi");
      qc.invalidateQueries({ queryKey: ['clinic-reviews', clinicId] });
    },
    onError: () => toast.error('Xatolik yuz berdi'),
  });

  const visible = reviews ?? [];
  const stats = useMemo(() => {
    const dist = [0, 0, 0, 0, 0]; // index 0 = 1 star
    let sum = 0;
    let count = 0;
    let unanswered = 0;
    let hidden = 0;
    let last30 = 0;
    const now = Date.now();
    for (const r of visible) {
      if (r.is_hidden) { hidden++; continue; }
      const idx = r.rating - 1;
      if (idx >= 0 && idx < 5) dist[idx] = (dist[idx] ?? 0) + 1;
      sum += r.rating;
      count++;
      if (!r.reply_text) unanswered++;
      if (now - new Date(r.created_at).getTime() < 30 * 86400_000) last30++;
    }
    return { dist, avg: count ? sum / count : 0, count, unanswered, hidden, last30 };
  }, [visible]);

  const filtered = visible.filter((r) => {
    if (filter === 'unanswered') return !r.reply_text && !r.is_hidden;
    if (filter === 'answered') return !!r.reply_text && !r.is_hidden;
    if (filter === 'hidden') return r.is_hidden;
    if (filter === 'all' && r.is_hidden) return false;
    return true;
  }).filter((r) => ratingFilter == null || r.rating === ratingFilter);

  const maxBar = Math.max(1, ...stats.dist);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Sharhlar</h2>
        <p className="text-sm text-muted-foreground">Bemorlardan kelgan reytinglar va izohlar</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="rounded-2xl border bg-card p-4 lg:col-span-2">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-4xl font-black text-amber-500">{stats.avg ? stats.avg.toFixed(1) : '—'}</p>
              <div className="mt-1 flex justify-center"><StarDisplay rating={Math.round(stats.avg)} /></div>
              <p className="mt-1 text-xs text-muted-foreground">{stats.count} sharh</p>
            </div>
            <div className="flex-1 space-y-1">
              {[5, 4, 3, 2, 1].map((star) => {
                const c = stats.dist[star - 1] ?? 0;
                const w = (c / maxBar) * 100;
                const active = ratingFilter === star;
                return (
                  <button
                    key={star}
                    onClick={() => setRatingFilter(active ? null : star)}
                    className={cn('flex w-full items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent', active && 'bg-accent')}
                  >
                    <span className="w-3 tabular-nums">{star}</span>
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${w}%` }} />
                    </div>
                    <span className="w-6 text-right tabular-nums text-muted-foreground">{c}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Javob kutmoqda</span>
            <Clock className="h-3.5 w-3.5 text-amber-600" />
          </div>
          <p className="mt-2 text-3xl font-black text-amber-600">{stats.unanswered}</p>
          <p className="mt-1 text-xs text-muted-foreground">javobsiz sharh</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Oxirgi 30 kun</span>
            <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
          </div>
          <p className="mt-2 text-3xl font-black">{stats.last30}</p>
          <p className="mt-1 text-xs text-muted-foreground">yangi sharh</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Yashirilgan</span>
            <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="mt-2 text-3xl font-black">{stats.hidden}</p>
          <p className="mt-1 text-xs text-muted-foreground">moderatsiya</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xl bg-muted/40 p-1">
          {(['all', 'unanswered', 'answered', 'hidden'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
                filter === f ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f === 'all' ? 'Barchasi' : f === 'unanswered' ? 'Javob kutmoqda' : f === 'answered' ? 'Javob berilgan' : 'Yashirin'}
            </button>
          ))}
        </div>
        {ratingFilter != null && (
          <button
            onClick={() => setRatingFilter(null)}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            {ratingFilter}★ filtri ×
          </button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <MessageSquare className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p>Sharh topilmadi</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <ReviewCard
              key={r.id}
              review={r}
              onReply={(id, text) => reply({ reviewId: id, text })}
              onToggleHide={(id, hide) => toggleHide({ id, hide })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
