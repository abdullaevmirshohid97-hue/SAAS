import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Search, Stethoscope, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
} from '@clary/ui-web';

import { api } from '@/lib/api';

export function DoctorsPage() {
  const [q, setQ] = useState('');
  const doctors = useQuery({
    queryKey: ['admin', 'doctors', q],
    queryFn: () => api.admin.listDoctors({ q: q || undefined }),
  });

  const impersonate = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.admin.impersonate(id, reason),
    onSuccess: (r) => {
      toast.success('Impersonation sessiyasi yaratildi');
      if (r.action_link) {
        window.open(r.action_link, '_blank', 'noopener,noreferrer');
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shifokorlar</h1>
        <p className="text-sm text-muted-foreground">
          Barcha klinikalardagi shifokorlar (super admin ko‘rinishi)
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
          placeholder="Ism yoki email bo‘yicha qidirish…"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {(doctors.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Stethoscope className="h-8 w-8" />}
              title="Shifokorlar topilmadi"
              description="Filtrni o‘zgartiring yoki klinikalarni tekshiring"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Shifokor</th>
                    <th className="px-4 py-2.5">Klinika</th>
                    <th className="px-4 py-2.5">Aloqa</th>
                    <th className="px-4 py-2.5">Holat</th>
                    <th className="px-4 py-2.5">So‘nggi kirish</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {(doctors.data ?? []).map((d) => (
                    <tr key={d.id} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{d.full_name}</div>
                        <div className="text-xs text-muted-foreground">{d.email}</div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{d.clinic?.name ?? '-'}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.phone ?? '-'}</td>
                      <td className="px-4 py-2.5">
                        {d.is_active ? (
                          <Badge variant="success">
                            <UserCheck className="mr-1 h-3 w-3" /> Faol
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <UserX className="mr-1 h-3 w-3" /> Nofaol
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {d.last_sign_in_at ? new Date(d.last_sign_in_at).toLocaleString('uz-UZ') : '-'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={impersonate.isPending}
                          onClick={() => {
                            const reason = window.prompt(
                              'Impersonatsiya sababi (kamida 10 ta belgi):',
                            );
                            if (reason && reason.length >= 10) {
                              impersonate.mutate({ id: d.id, reason });
                            } else if (reason !== null) {
                              toast.error('Sabab kamida 10 ta belgi bo‘lishi kerak');
                            }
                          }}
                        >
                          Impersonate
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
