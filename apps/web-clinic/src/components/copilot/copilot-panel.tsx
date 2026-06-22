import { useRef, useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, Send, Loader2, Bot, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';

import {
  Button,
  Textarea,
  Badge,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

// Copilot faqat klinika rahbari uchun (server ham @Roles bilan 403 qaytaradi —
// bu UI gate kosmetik, asosiy himoya serverda).
const ADMIN_ROLES = new Set(['clinic_admin', 'clinic_owner', 'super_admin']);

const QUICK_PROMPTS = [
  'Bu oy tushum qancha?',
  'Eng yaxshi 5 xizmat',
  "Yo'qolish xavfidagi bemorlar",
  'Naqd tushum prognozi',
];

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  tools?: string[];
}

function CopilotChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const mut = useMutation({
    mutationFn: (history: ChatMessage[]) =>
      api.analytics.aiCopilot(history.map((m) => ({ role: m.role, content: m.content }))),
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply, tools: data.tool_calls },
      ]);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      // foydalanuvchi xabarini qoldiramiz, lekin xato bo'lsa qayta urinish mumkin
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, mut.isPending]);

  function send(text: string) {
    const q = text.trim();
    if (!q || mut.isPending) return;
    const userMsg: ChatMessage = { role: 'user', content: q };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    mut.mutate(next);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Xabarlar */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-4 pr-1">
        {messages.length === 0 && !mut.isPending && (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
              Klinikangiz bo'yicha savol bering — tushum, xarajat, shifokorlar,
              xizmatlar, bemor segmentlari, prognoz va kassa holati.
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => send(p)}
                  className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                m.role === 'user' ? 'bg-muted text-foreground' : 'bg-primary/15 text-primary'
              }`}
            >
              {m.role === 'user' ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>
            <div className={`max-w-[85%] ${m.role === 'user' ? 'text-right' : ''}`}>
              <div
                className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/60 text-foreground'
                }`}
              >
                {m.content}
              </div>
              {m.tools && m.tools.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {Array.from(new Set(m.tools)).map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px] font-normal">
                      📊 {t}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {mut.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Tahlil qilinmoqda…
          </div>
        )}
      </div>

      {/* Kiritish */}
      <div className="border-t pt-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Savolingizni yozing…"
            rows={1}
            className="max-h-32 min-h-[40px] resize-none"
          />
          <Button
            size="icon"
            onClick={() => send(input)}
            disabled={mut.isPending || !input.trim()}
            aria-label="Yuborish"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Copilot faqat shu klinikaning analitikasiga javob beradi. Tibbiy maslahat bermaydi.
        </p>
      </div>
    </div>
  );
}

// Suzuvchi tugma + Sheet — AppShell ichida global render qilinadi.
export function CopilotLauncher() {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);

  if (!ADMIN_ROLES.has(role)) return null;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 h-12 gap-2 rounded-full shadow-lg lg:bottom-6"
        aria-label="AI Copilot"
      >
        <Sparkles className="h-5 w-5" />
        <span className="hidden sm:inline">Copilot</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> AI Copilot
            </SheetTitle>
            <SheetDescription>Klinika analitikasi bo'yicha aqlli yordamchi</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <CopilotChat />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
