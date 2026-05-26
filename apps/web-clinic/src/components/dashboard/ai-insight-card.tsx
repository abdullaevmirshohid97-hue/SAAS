import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, Button } from '@clary/ui-web';

import { api } from '@/lib/api';

// AI Insight — Anthropic Claude'dan bugungi 3 ta tavsiya.
// Foydalanuvchi tugmani bosgan paytda chaqiriladi (har kuni 1-2 marta).
// Server tarafida rate limit (100/kun/klinika).
export function AiInsightCard() {
  const [lines, setLines] = useState<string[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const mut = useMutation({
    mutationFn: () => api.analytics.aiDailyInsight(),
    onSuccess: (data) => {
      setLines(data.lines);
      setUpdatedAt(new Date());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">AI tavsiya (Claude)</div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs"
                onClick={() => mut.mutate()}
                disabled={mut.isPending}
              >
                {mut.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {lines ? 'Qayta' : 'Olish'}
              </Button>
            </div>

            {lines === null && !mut.isPending && (
              <div className="mt-2 text-xs text-muted-foreground">
                Bugungi ko'rsatkichlar asosida shaxsiy tavsiya olish uchun
                tugmani bosing.
              </div>
            )}

            {mut.isPending && (
              <div className="mt-2 text-xs text-muted-foreground">
                Claude'dan tahlil olinmoqda…
              </div>
            )}

            {lines && lines.length > 0 && (
              <>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {lines.map((line, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-primary">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                {updatedAt && (
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    {updatedAt.toLocaleTimeString('uz-UZ', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })} da yangilangan
                  </div>
                )}
              </>
            )}

            {lines && lines.length === 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                Hozircha tavsiya yo'q (yetarli ma'lumot yo'q yoki AI javob
                bermadi).
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
