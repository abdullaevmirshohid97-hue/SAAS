import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  Download,
  Loader2,
  Send,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@clary/ui-web';
import type { FinanceReport } from '@clary/api-client';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { useClosingDay } from '@/hooks/use-closing-day';

import { MonthCloseDialog } from '../analytics/month-close-dialog';
import { ROBOT_TASKS, type RobotTask } from './robot-tasks';

// =============================================================================
// CLARY ROBOT — tugmali vazifalar
// =============================================================================
// Ilgari bu suzuvchi tugma AI chat edi ("Copilot"): foydalanuvchi savol
// yozardi, model javob berardi. Bu yerda AI yo'q — har tugma AYNAN bitta
// ishni bajaradi va natija har safar bir xil chiqadi.
//
// Raqamlar Hisobot quruvchi bilan bitta manbadan (`finance-report/build`)
// keladi — ikki ekran bir xil davr uchun turli raqam ko'rsatmasligi uchun.
// =============================================================================

// Moliyaviy ma'lumot — faqat rahbariyat. Server ham @Roles bilan 403 qaytaradi;
// bu UI gate kosmetik.
const ADMIN_ROLES = new Set(['clinic_admin', 'clinic_owner', 'super_admin']);

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

function TaskCard({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:border-primary/40 hover:bg-muted/40 flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors"
    >
      <span className="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="text-muted-foreground block text-xs">{hint}</span>
      </span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2.5">
      <div className="text-muted-foreground text-[10px] uppercase">{label}</div>
      <div className="text-sm font-bold tabular-nums">{fmt(value)}</div>
    </div>
  );
}

/** Yopish bloki — davr allaqachon yopilgan bo'lsa tugma o'chadi. */
function CloseBlock({
  from,
  to,
  report,
  onClosed,
}: {
  from: string;
  to: string;
  report: FinanceReport;
  onClosed: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      {report.closed ? (
        <Badge variant="secondary" className="w-fit">
          Davr yopilgan — {new Date(report.closed.closed_at).toLocaleDateString('uz-UZ')}
        </Badge>
      ) : (
        <p className="text-muted-foreground text-xs">
          Kassa sanaladi, farq ochiq yoziladi, naqd seyfga o&rsquo;tadi, naqdsiz pul tanlangan
          hisobga ketadi va davr qulflanadi.
        </p>
      )}
      <MonthCloseDialog
        from={from}
        to={to}
        report={report}
        disabled={!!report.closed}
        onClosed={onClosed}
      />
    </div>
  );
}

/** Tanlangan vazifa — hisobot yig'iladi va amal tugmalari ko'rsatiladi. */
function TaskRunner({ task, onBack }: { task: RobotTask; onBack: () => void }) {
  const closingDay = useClosingDay();
  const { from, to } = task.range(closingDay);

  const { data: tg } = useQuery({
    queryKey: ['telegram-status'],
    queryFn: () => api.telegramReports.status(),
    staleTime: 60_000,
  });
  const tgConnected = tg?.connected ?? false;

  const {
    data: rep,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['finance-report', from, to, 'robot'],
    queryFn: () => api.financeReport.build({ from, to }),
    // Moliyaviy raqam — eskirgani ko'rsatilmasin.
    staleTime: 0,
  });

  const [downloading, setDownloading] = useState(false);
  async function downloadPdf() {
    setDownloading(true);
    try {
      const blob = await api.financeReport.pdf({ from, to });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `moliyaviy-hisobot-${from}_${to}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message || 'PDF yaratilmadi');
    } finally {
      setDownloading(false);
    }
  }

  const sendMut = useMutation({
    mutationFn: () => api.telegramReports.sendFinance({ from, to }),
    onSuccess: (r) =>
      toast.success(
        `Telegramga yuborildi (${r.sent} ta chat)` + (r.pdf ? '' : ' — PDF yasalmadi, matn ketdi'),
      ),
    onError: (e: Error) => toast.error(e.message),
  });

  const hasFooter = task.actions.includes('pdf') || task.actions.includes('telegram');

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={onBack}
        className="text-muted-foreground hover:text-foreground mb-3 flex items-center gap-1.5 text-xs"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Vazifalar
      </button>

      <div className="mb-3">
        <div className="text-sm font-semibold">{task.label}</div>
        <div className="text-muted-foreground text-xs tabular-nums">
          {from} &rarr; {to}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {isFetching && (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Hisobot yig&rsquo;ilmoqda&hellip;
          </div>
        )}

        {isError && (
          <div className="border-destructive/40 text-destructive rounded-md border p-3 text-xs">
            {(error as Error)?.message || 'Hisobot olinmadi'}
            <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => refetch()}>
              Qayta urinish
            </Button>
          </div>
        )}

        {rep && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Tushum" value={rep.totals.gross_revenue_uzs} />
              <Stat label="Rasxot" value={rep.totals.total_expense_uzs} />
              <Stat label="Kassada naqd" value={rep.closing.cash} />
              <Stat label="Seyfda" value={rep.closing.safe} />
              <Stat label="Bankka o&rsquo;tmagan" value={rep.closing.pending} />
              <Stat label="Sof natija" value={rep.totals.operating_net_uzs} />
            </div>

            {rep.warnings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                <div className="mb-1 flex items-center gap-1.5 font-semibold">
                  <TriangleAlert className="h-3.5 w-3.5" /> Svertka mos kelmadi
                </div>
                {rep.warnings.map((w) => (
                  <div key={w}>{w}</div>
                ))}
              </div>
            )}

            {task.actions.includes('close') && (
              <CloseBlock from={from} to={to} report={rep} onClosed={() => void refetch()} />
            )}
          </>
        )}
      </div>

      {rep && hasFooter && (
        <div className="space-y-2 border-t pt-3">
          {task.actions.includes('pdf') && (
            <Button
              variant="outline"
              className="w-full"
              onClick={downloadPdf}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-4 w-4" />
              )}
              PDF tayyorlash
            </Button>
          )}
          {task.actions.includes('telegram') && (
            <>
              <Button
                className="w-full"
                onClick={() => sendMut.mutate()}
                disabled={sendMut.isPending || !tgConnected}
              >
                {sendMut.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-4 w-4" />
                )}
                Telegramga jo&rsquo;natish
              </Button>
              {!tgConnected && (
                <p className="text-muted-foreground text-[10px]">
                  Hisobot bot ulanmagan — Sozlamalar &rarr; Integratsiyalar &rarr; Hisobot bot.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Suzuvchi tugma + Sheet — AppShell ichida global render qilinadi.
export function RobotLauncher() {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState<RobotTask | null>(null);

  if (!ADMIN_ROLES.has(role)) return null;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 h-12 gap-2 rounded-full shadow-lg lg:bottom-6"
        aria-label="Robot"
      >
        <Bot className="h-5 w-5" />
        <span className="hidden sm:inline">Robot</span>
      </Button>

      <Sheet
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setTask(null);
        }}
      >
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bot className="text-primary h-5 w-5" /> Clary Robot
            </SheetTitle>
            <SheetDescription>Tayyor vazifalar — bir bosishda bajariladi</SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 py-3">
            {task ? (
              <TaskRunner task={task} onBack={() => setTask(null)} />
            ) : (
              <div className="space-y-2 overflow-y-auto pr-1">
                {ROBOT_TASKS.map((t) => (
                  <TaskCard
                    key={t.id}
                    icon={t.icon}
                    label={t.label}
                    hint={t.hint}
                    onClick={() => setTask(t)}
                  />
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
