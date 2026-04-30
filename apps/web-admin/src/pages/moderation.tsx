import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@clary/ui-web';
import {
  Globe,
  Star,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  MessageSquare,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import { api } from '@/lib/api';

interface WebProfile {
  clinic_id: string;
  is_published: boolean;
  tagline: string | null;
  updated_at: string;
  clinic?: { id: string; name: string; city: string | null; logo_url: string | null };
}

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  helpful_count: number;
  is_hidden: boolean;
  is_verified: boolean;
  created_at: string;
  clinic?: { id: string; name: string };
}

function StarRow({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} className={`h-3.5 w-3.5 ${s <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} />
      ))}
    </div>
  );
}

export function ModerationPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'profiles' | 'reviews'>('profiles');
  const [profileFilter, setProfileFilter] = useState<boolean | undefined>();
  const [reviewFilter, setReviewFilter] = useState<boolean | undefined>();
  const [profilePage, setProfilePage] = useState(1);
  const [reviewPage, setReviewPage] = useState(1);

  const { data: profiles, isLoading: profilesLoading } = useQuery<{ data: WebProfile[]; total: number }>({
    queryKey: ['mod-profiles', profileFilter, profilePage],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(profilePage) });
      if (profileFilter !== undefined) p.set('published', String(profileFilter));
      return api.get(`/api/v1/admin/moderation/web-profiles?${p}`);
    },
    enabled: tab === 'profiles',
  });

  const { data: reviews, isLoading: reviewsLoading } = useQuery<{ data: Review[]; total: number }>({
    queryKey: ['mod-reviews', reviewFilter, reviewPage],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(reviewPage) });
      if (reviewFilter !== undefined) p.set('hidden', String(reviewFilter));
      return api.get(`/api/v1/admin/moderation/reviews?${p}`);
    },
    enabled: tab === 'reviews',
  });

  const profileMut = useMutation({
    mutationFn: ({ clinicId, action }: { clinicId: string; action: 'publish' | 'unpublish' }) =>
      api.post(`/api/v1/admin/moderation/web-profiles/${clinicId}`, { action }),
    onSuccess: () => {
      toast.success('Profil yangilandi');
      qc.invalidateQueries({ queryKey: ['mod-profiles'] });
    },
    onError: () => toast.error('Xatolik yuz berdi'),
  });

  const reviewMut = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) =>
      api.post(`/api/v1/admin/moderation/reviews/${id}`, { hidden }),
    onSuccess: () => {
      toast.success('Izoh yangilandi');
      qc.invalidateQueries({ queryKey: ['mod-reviews'] });
    },
    onError: () => toast.error('Xatolik yuz berdi'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Moderatsiya</h1>
        <p className="text-sm text-muted-foreground">Web profillar va izohlarni tekshirish</p>
      </div>

      <div className="flex gap-1 rounded-xl bg-muted/40 p-1 w-fit">
        <button
          onClick={() => setTab('profiles')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'profiles' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Globe className="h-4 w-4" /> Web profillar
        </button>
        <button
          onClick={() => setTab('reviews')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'reviews' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <MessageSquare className="h-4 w-4" /> Izohlar
        </button>
      </div>

      {tab === 'profiles' && (
        <>
          <div className="flex gap-1 rounded-xl bg-muted/40 p-1 w-fit">
            {([undefined, true, false] as const).map((v, i) => (
              <button
                key={i}
                onClick={() => { setProfileFilter(v); setProfilePage(1); }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${profileFilter === v ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
              >
                {v === undefined ? 'Barchasi' : v ? 'Nashr etilgan' : 'Kutmoqda'}
              </button>
            ))}
          </div>

          {profilesLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(profiles?.data ?? []).map((p) => (
                <Card key={p.clinic_id}>
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-sm">{p.clinic?.name}</p>
                        {p.clinic?.city && <p className="text-xs text-muted-foreground">{p.clinic.city}</p>}
                        {p.tagline && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.tagline}</p>}
                      </div>
                      {p.is_published ? (
                        <Badge variant="success" className="shrink-0">Nashr</Badge>
                      ) : (
                        <Badge variant="outline" className="shrink-0">Tasdiq kutmoqda</Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}
                      </span>
                      <div className="flex gap-1.5">
                        {p.is_published ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => profileMut.mutate({ clinicId: p.clinic_id, action: 'unpublish' })}
                            disabled={profileMut.isPending}
                          >
                            <EyeOff className="mr-1 h-3.5 w-3.5" /> Yashirish
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => profileMut.mutate({ clinicId: p.clinic_id, action: 'publish' })}
                            disabled={profileMut.isPending}
                          >
                            <Eye className="mr-1 h-3.5 w-3.5" /> Nashr etish
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {(profiles?.data ?? []).length === 0 && (
                <div className="col-span-full flex flex-col items-center py-10 text-muted-foreground">
                  <Globe className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">Web profillar topilmadi</p>
                </div>
              )}
            </div>
          )}

          {(profiles?.total ?? 0) > 30 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setProfilePage((p) => Math.max(1, p - 1))} disabled={profilePage === 1}>Oldingi</Button>
              <span className="text-sm text-muted-foreground">{profilePage}</span>
              <Button variant="outline" size="sm" onClick={() => setProfilePage((p) => p + 1)} disabled={(profiles?.data ?? []).length < 30}>Keyingi</Button>
            </div>
          )}
        </>
      )}

      {tab === 'reviews' && (
        <>
          <div className="flex gap-1 rounded-xl bg-muted/40 p-1 w-fit">
            {([undefined, false, true] as const).map((v, i) => (
              <button
                key={i}
                onClick={() => { setReviewFilter(v); setReviewPage(1); }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${reviewFilter === v ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
              >
                {v === undefined ? 'Barchasi' : v === false ? 'Ko'rinadigan' : 'Yashirilgan'}
              </button>
            ))}
          </div>

          {reviewsLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Klinika</th>
                        <th className="px-4 py-3">Reyting</th>
                        <th className="px-4 py-3">Izoh</th>
                        <th className="px-4 py-3">Foydali</th>
                        <th className="px-4 py-3">Holat</th>
                        <th className="px-4 py-3">Sana</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {(reviews?.data ?? []).map((r) => (
                        <tr key={r.id} className={`border-b last:border-b-0 hover:bg-muted/20 ${r.is_hidden ? 'opacity-50' : ''}`}>
                          <td className="px-4 py-3 font-medium">{r.clinic?.name ?? '—'}</td>
                          <td className="px-4 py-3"><StarRow rating={r.rating} /></td>
                          <td className="px-4 py-3 max-w-[240px]">
                            <p className="text-xs text-muted-foreground line-clamp-2">{r.comment ?? '—'}</p>
                          </td>
                          <td className="px-4 py-3 text-center text-muted-foreground">{r.helpful_count}</td>
                          <td className="px-4 py-3">
                            {r.is_hidden
                              ? <Badge variant="outline">Yashirilgan</Badge>
                              : <Badge variant="success">Ko'rinadigan</Badge>}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => reviewMut.mutate({ id: r.id, hidden: !r.is_hidden })}
                              disabled={reviewMut.isPending}
                            >
                              {r.is_hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(reviews?.data ?? []).length === 0 && (
                    <div className="flex flex-col items-center py-10 text-muted-foreground">
                      <MessageSquare className="h-8 w-8 mb-2 opacity-30" />
                      <p className="text-sm">Izohlar topilmadi</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {(reviews?.total ?? 0) > 50 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setReviewPage((p) => Math.max(1, p - 1))} disabled={reviewPage === 1}>Oldingi</Button>
              <span className="text-sm text-muted-foreground">{reviewPage}</span>
              <Button variant="outline" size="sm" onClick={() => setReviewPage((p) => p + 1)} disabled={(reviews?.data ?? []).length < 50}>Keyingi</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
