import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from '@clary/ui-web';
import {
  Users,
  Search,
  ShieldOff,
  ShieldCheck,
  Loader2,
  MapPin,
  CalendarDays,
  Activity,
  X,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import { api } from '@/lib/api';

interface PortalUser {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  region: string | null;
  is_active: boolean;
  is_suspended: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

interface Stats {
  total: number;
  new_this_week: number;
  bookings_total: number;
  nurse_requests_total: number;
  top_cities: Array<{ city: string; count: number }>;
}

interface UserDetail {
  user: PortalUser;
  bookings: Array<{ id: string; status: string; created_at: string; clinic?: { name: string }; slot?: { starts_at: string } }>;
  nurse_requests: Array<{ id: string; status: string; service: string; created_at: string; clinic?: { name: string } }>;
  reviews: Array<{ id: string; rating: number; clinic?: { name: string }; created_at: string }>;
}

function UserDetailModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<UserDetail>({
    queryKey: ['portal-user', userId],
    queryFn: () => api.get(`/api/v1/admin/portal-users/${userId}`),
  });

  const suspendMut = useMutation({
    mutationFn: (reason: string) => api.post(`/api/v1/admin/portal-users/${userId}/suspend`, { reason }),
    onSuccess: () => {
      toast.success("Foydalanuvchi to'xtatildi");
      qc.invalidateQueries({ queryKey: ['portal-users'] });
      qc.invalidateQueries({ queryKey: ['portal-user', userId] });
    },
    onError: () => toast.error('Xatolik yuz berdi'),
  });

  const unsuspendMut = useMutation({
    mutationFn: () => api.post(`/api/v1/admin/portal-users/${userId}/unsuspend`, {}),
    onSuccess: () => {
      toast.success('Foydalanuvchi yoqildi');
      qc.invalidateQueries({ queryKey: ['portal-users'] });
      qc.invalidateQueries({ queryKey: ['portal-user', userId] });
    },
    onError: () => toast.error('Xatolik yuz berdi'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-background border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">Foydalanuvchi tafsilotlari</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data ? (
          <div className="space-y-4 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-semibold">{data.user.full_name ?? '—'}</p>
                <p className="text-sm text-muted-foreground">{data.user.email ?? data.user.phone ?? '—'}</p>
                {data.user.city && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <MapPin className="h-3 w-3" /> {data.user.city}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {data.user.is_suspended ? (
                  <Button size="sm" variant="outline" onClick={() => unsuspendMut.mutate()} disabled={unsuspendMut.isPending}>
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Yoqish
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={suspendMut.isPending}
                    onClick={() => {
                      const r = prompt("To'xtatish sababi:");
                      if (r) suspendMut.mutate(r);
                    }}
                  >
                    <ShieldOff className="mr-1.5 h-3.5 w-3.5" /> To'xtatish
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl border p-3">
                <p className="text-2xl font-bold">{data.bookings.length}</p>
                <p className="text-xs text-muted-foreground">Bronlar</p>
              </div>
              <div className="rounded-xl border p-3">
                <p className="text-2xl font-bold">{data.nurse_requests.length}</p>
                <p className="text-xs text-muted-foreground">Hamshira so'rovlari</p>
              </div>
              <div className="rounded-xl border p-3">
                <p className="text-2xl font-bold">{data.reviews.length}</p>
                <p className="text-xs text-muted-foreground">Izohlar</p>
              </div>
            </div>

            {data.bookings.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">So'nggi bronlar</p>
                <div className="space-y-1.5">
                  {data.bookings.slice(0, 5).map((b) => (
                    <div key={b.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                      <span>{b.clinic?.name ?? '—'}</span>
                      <Badge variant={b.status === 'confirmed' ? 'success' : 'outline'}>{b.status}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="p-6 text-center text-muted-foreground">Ma'lumot topilmadi</p>
        )}
      </div>
    </div>
  );
}

export function PortalUsersPage() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [suspended, setSuspended] = useState<boolean | undefined>();
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: stats } = useQuery<Stats>({
    queryKey: ['portal-users-stats'],
    queryFn: () => api.get('/api/v1/admin/portal-users/stats'),
  });

  const { data, isLoading } = useQuery<{ data: PortalUser[]; total: number }>({
    queryKey: ['portal-users', debouncedQ, suspended, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (debouncedQ) params.set('q', debouncedQ);
      if (suspended !== undefined) params.set('suspended', String(suspended));
      return api.get(`/api/v1/admin/portal-users?${params}`);
    },
  });

  const handleSearch = (val: string) => {
    setQ(val);
    setTimeout(() => { setDebouncedQ(val); setPage(1); }, 300);
  };

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Axoli foydalanuvchilari</h1>
        <p className="text-sm text-muted-foreground">Portal orqali ro'yxatdan o'tgan foydalanuvchilar</p>
      </div>

      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Jami</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold">{stats.total.toLocaleString()}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Shu hafta yangi</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-emerald-600">+{stats.new_this_week}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Jami bronlar</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold">{stats.bookings_total.toLocaleString()}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Hamshira so'rovlari</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold">{stats.nurse_requests_total.toLocaleString()}</p></CardContent>
          </Card>
        </div>
      )}

      {stats?.top_cities && stats.top_cities.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Top shaharlar</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.top_cities.map((c) => (
                <button
                  key={c.city}
                  onClick={() => { setSuspended(undefined); setPage(1); }}
                  className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs hover:bg-muted"
                >
                  <MapPin className="h-3 w-3 text-muted-foreground" />
                  {c.city}
                  <span className="font-semibold text-primary">{c.count}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Ism, telefon yoki email bo'yicha..."
            value={q}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-xl bg-muted/40 p-1">
          {([undefined, false, true] as const).map((v, i) => (
            <button
              key={i}
              onClick={() => { setSuspended(v); setPage(1); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                suspended === v ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v === undefined ? 'Barchasi' : v === false ? 'Faol' : "To'xtatilgan"}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Foydalanuvchi</th>
                    <th className="px-4 py-3">Telefon</th>
                    <th className="px-4 py-3">Shahar</th>
                    <th className="px-4 py-3">Holat</th>
                    <th className="px-4 py-3">Ro'yxatdan</th>
                    <th className="px-4 py-3">So'nggi kirish</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {(data?.data ?? []).map((u) => (
                    <tr key={u.id} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="font-medium">{u.full_name ?? '—'}</div>
                        <div className="text-xs text-muted-foreground">{u.email ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{u.phone ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.city ?? '—'}</td>
                      <td className="px-4 py-3">
                        {u.is_suspended ? (
                          <Badge variant="destructive">To'xtatilgan</Badge>
                        ) : (
                          <Badge variant="success">Faol</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {formatDistanceToNow(new Date(u.created_at), { addSuffix: true })}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {u.last_sign_in_at
                          ? formatDistanceToNow(new Date(u.last_sign_in_at), { addSuffix: true })
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setSelectedId(u.id)}>
                          Ko'rish
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(data?.data ?? []).length === 0 && (
                <div className="flex flex-col items-center py-10 text-muted-foreground">
                  <Users className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">Foydalanuvchi topilmadi</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            Oldingi
          </Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            Keyingi
          </Button>
        </div>
      )}

      {selectedId && (
        <UserDetailModal userId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
