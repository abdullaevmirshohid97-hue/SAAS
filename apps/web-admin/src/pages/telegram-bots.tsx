import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent } from '@clary/ui-web';
import { Bot, ExternalLink, Power, PowerOff } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

export function TelegramBotsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'telegram-bots'],
    queryFn: () => api.admin.listTelegramBots(),
  });
  const bots = data ?? [];

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.admin.toggleTelegramBot(id, isActive),
    onSuccess: () => {
      toast.success('Holat yangilandi');
      qc.invalidateQueries({ queryKey: ['admin', 'telegram-bots'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Telegram botlar</h1>
        <p className="text-sm text-muted-foreground">
          Har klinikaning Telegram boti — ro‘yxat va holatni boshqarish.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3">Klinika</th>
                <th className="p-3">Bot</th>
                <th className="p-3">Ro‘yxatdan o‘tilgan</th>
                <th className="p-3">Holat</th>
                <th className="p-3 text-right">Amal</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
                    Yuklanmoqda…
                  </td>
                </tr>
              ) : bots.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
                    <Bot className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    Hech bir klinika hali Telegram bot ro‘yxatdan o‘tkazmagan
                  </td>
                </tr>
              ) : (
                bots.map((b) => (
                  <tr key={b.id} className="border-b last:border-0 hover:bg-accent/50">
                    <td className="p-3 font-medium">{b.clinic?.name ?? '—'}</td>
                    <td className="p-3">
                      <a
                        href={`https://t.me/${b.bot_username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-sm text-primary hover:underline"
                      >
                        @{b.bot_username}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {new Date(b.registered_at).toLocaleString('uz-UZ')}
                    </td>
                    <td className="p-3">
                      {b.is_active ? (
                        <Badge variant="success">Faol</Badge>
                      ) : (
                        <Badge variant="destructive">O‘chirilgan</Badge>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={toggleMut.isPending}
                        onClick={() =>
                          toggleMut.mutate({ id: b.id, isActive: !b.is_active })
                        }
                      >
                        {b.is_active ? (
                          <>
                            <PowerOff className="h-3.5 w-3.5" />
                            O‘chirish
                          </>
                        ) : (
                          <>
                            <Power className="h-3.5 w-3.5" />
                            Yoqish
                          </>
                        )}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
