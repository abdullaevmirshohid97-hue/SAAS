import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PageHeader,
  cn,
} from '@clary/ui-web';
import type {
  PbxExtension,
  PbxExtensionCredentials,
  PbxSettingsOverview,
  PbxTenantInput,
} from '@clary/api-client';
import { Copy, KeyRound, Monitor, Pencil, Phone, Plus, RefreshCw, Trash2 } from 'lucide-react';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

// =============================================================================
// Sozlamalar → IP-telefoniya (bulutli ATS)
// =============================================================================
// Klinika raqami (Uztelecom IP-telefoniya) Clary serveridagi Asterisk'ga ulanadi:
// kiruvchi qo'ng'iroq stol IP telefonlari + Clary softfonida birdan jiringlaydi,
// hech kim olmasa — AI qabulxona. Batafsil: docs/ai-reception/05-bulut-ats.md
// =============================================================================

const selectCls = 'border-input bg-background h-9 w-full rounded-md border px-2 text-sm';

const EMPTY: PbxTenantInput = {
  enabled: false,
  trunk_host: null,
  trunk_port: 5060,
  trunk_transport: 'udp',
  trunk_username: null,
  trunk_password: null,
  trunk_from_domain: null,
  did: null,
  dial_format: 'digits12',
  ring_timeout_sec: 20,
  after_hours: 'ai',
  no_answer: 'voicemail',
  max_outbound: 4,
};

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Nusxa olindi');
  } catch {
    toast.error('Nusxa olinmadi');
  }
}

function trunkBadge(status: string | null) {
  const s = (status ?? '').toLowerCase();
  if (s === 'registered') return <Badge variant="success">Ulangan</Badge>;
  if (s === 'rejected')
    return <Badge variant="destructive">Rad etildi — login/parolni tekshiring</Badge>;
  if (s === 'unregistered' || s === 'stopped') return <Badge variant="warning">Ulanmagan</Badge>;
  if (s) return <Badge variant="outline">{status}</Badge>;
  return <Badge variant="outline">Hali tekshirilmadi</Badge>;
}

export function SettingsTelephonyPage() {
  const { can } = useAuth();
  const canManage = can('settings.manage_integrations');
  const q = useQuery({
    queryKey: ['telephony', 'settings'],
    queryFn: () => api.telephony.settings(),
    refetchInterval: 15_000,
  });

  if (q.isLoading) return <div className="text-muted-foreground text-sm">Yuklanmoqda…</div>;
  if (q.error || !q.data) {
    return (
      <Card>
        <CardContent className="text-destructive p-4 text-sm">
          {(q.error as Error | null)?.message ?? 'Yuklab bo‘lmadi'}
        </CardContent>
      </Card>
    );
  }
  const o = q.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title="IP-telefoniya (bulutli ATS)"
        description="Klinika raqami Clary’ga ulanadi: qo‘ng‘iroq stol IP telefonlari va Clary ilovasida (kompyuterda) birdan jiringlaydi, hech kim olmasa — bemor ovozli xabar qoldiradi (yoki AI qabulxona). Chiquvchi — bemor kartasidan bir bosishda, klinika raqami bilan."
      />

      {!o.server.configured && (
        <Card className="border-amber-400">
          <CardContent className="p-4 text-sm">
            <b>Clary ATS serveri hali ulanmagan.</b> Sozlamani saqlab qo‘yishingiz mumkin — server
            ishga tushgach (Clary jamoasi) telefonlar avtomatik ulanadi.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Holat"
          value={o.tenant?.enabled ? 'Yoqilgan' : 'O‘chiq'}
          ok={!!o.tenant?.enabled}
        />
        <div className="bg-card rounded-xl border p-3">
          <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
            Uztelecom liniyasi
          </div>
          <div className="mt-1">{trunkBadge(o.tenant?.trunk_status ?? null)}</div>
        </div>
        <Stat
          label="Ichki raqamlar"
          value={String(o.extensions.filter((e) => e.is_active).length)}
        />
        <Stat
          label="Onlayn qurilmalar"
          value={String(
            o.extensions.filter((e) => e.phone_status === 'online' || e.web_status === 'online')
              .length,
          )}
        />
      </div>

      <TrunkCard o={o} canManage={canManage} />
      <ExtensionsCard o={o} canManage={canManage} />
      <HowToCard o={o} />
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="bg-card rounded-xl border p-3">
      <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
        {label}
      </div>
      <div className={cn('mt-1 text-sm font-semibold', ok && 'text-emerald-600')}>{value}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-muted-foreground text-xs font-medium">{label}</label>
      {children}
      {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uztelecom liniyasi (trunk)
// ---------------------------------------------------------------------------
function TrunkCard({ o, canManage }: { o: PbxSettingsOverview; canManage: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PbxTenantInput | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const t = o.tenant;

  useEffect(() => {
    if (form) return;
    setForm(
      t
        ? {
            enabled: t.enabled,
            trunk_host: t.trunk_host,
            trunk_port: t.trunk_port,
            trunk_transport: t.trunk_transport,
            trunk_username: t.trunk_username,
            trunk_password: null,
            trunk_from_domain: t.trunk_from_domain,
            did: t.did,
            dial_format: t.dial_format,
            ring_timeout_sec: t.ring_timeout_sec,
            after_hours: t.after_hours,
            no_answer: t.no_answer ?? 'voicemail',
            max_outbound: t.max_outbound,
          }
        : EMPTY,
    );
  }, [t, form]);

  const save = useMutation({
    mutationFn: (body: PbxTenantInput) => api.telephony.saveSettings(body),
    onSuccess: () => {
      toast.success('Saqlandi — server 30 soniya ichida yangilanadi');
      setForm((f) => (f ? { ...f, trunk_password: null } : f));
      qc.invalidateQueries({ queryKey: ['telephony'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!form) return null;
  const set = <K extends keyof PbxTenantInput>(k: K, v: PbxTenantInput[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const ro = !canManage;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Klinika raqami — Uztelecom IP-telefoniya</CardTitle>
        {t?.trunk_status_at && (
          <span className="text-muted-foreground text-xs">
            tekshirildi: {new Date(t.trunk_status_at).toLocaleTimeString('uz-UZ')}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="accent-primary h-4 w-4"
            checked={form.enabled}
            disabled={ro}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          Bulutli ATS yoqilgan (qo‘ng‘iroqlar Clary orqali)
        </label>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="SIP server (Uztelecom bergan)" hint="Masalan: sip.uztelecom.uz yoki IP">
            <Input
              value={form.trunk_host ?? ''}
              disabled={ro}
              placeholder="sip.example.uz"
              onChange={(e) => set('trunk_host', e.target.value.trim() || null)}
            />
          </Field>
          <Field label="Login (SIP foydalanuvchi)">
            <Input
              value={form.trunk_username ?? ''}
              disabled={ro}
              autoComplete="off"
              onChange={(e) => set('trunk_username', e.target.value.trim() || null)}
            />
          </Field>
          <Field
            label="Parol"
            hint={t?.has_password ? 'Saqlangan. O‘zgartirish uchun yangisini yozing.' : undefined}
          >
            <Input
              type="password"
              value={form.trunk_password ?? ''}
              disabled={ro}
              autoComplete="new-password"
              placeholder={t?.has_password ? '••••••••' : ''}
              onChange={(e) => set('trunk_password', e.target.value || null)}
            />
          </Field>
          <Field
            label="Klinika raqami (bemorlar biladigan)"
            hint="Chiquvchi qo‘ng‘iroqda shu ko‘rinadi"
          >
            <Input
              value={form.did ?? ''}
              disabled={ro}
              placeholder="71 200 00 00"
              onChange={(e) => set('did', e.target.value || null)}
            />
          </Field>
          <Field label="Necha soniya jiringlasin" hint="Keyin — “Hech kim olmasa” tanlovi">
            <Input
              type="number"
              min={5}
              max={120}
              value={form.ring_timeout_sec}
              disabled={ro}
              onChange={(e) => set('ring_timeout_sec', Number(e.target.value) || 20)}
            />
          </Field>
          <Field
            label="Hech kim olmasa"
            hint="Ovozli xabar — bepul, uchinchi tomonsiz; yozuv “Qo‘ng‘iroqlar”da"
          >
            <select
              className={selectCls}
              value={form.no_answer}
              disabled={ro}
              onChange={(e) => set('no_answer', e.target.value as PbxTenantInput['no_answer'])}
            >
              <option value="voicemail">Ovozli xabar qoldirsin</option>
              <option value="ai">AI qabulxona (yoqilgan bo‘lsa, aks holda ovozli xabar)</option>
              <option value="message">Faqat “keyinroq qo‘ng‘iroq qiling” xabari</option>
            </select>
          </Field>
          <Field label="Ish vaqtidan tashqari">
            <select
              className={selectCls}
              value={form.after_hours}
              disabled={ro}
              onChange={(e) => set('after_hours', e.target.value as 'ring' | 'ai')}
            >
              <option value="ai">Darhol javob (ovozli xabar / AI)</option>
              <option value="ring">Baribir telefonlar jiringlasin</option>
            </select>
          </Field>
        </div>

        <button
          type="button"
          className="text-primary text-xs underline"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced
            ? 'Qo‘shimcha sozlamalarni yashirish'
            : 'Qo‘shimcha sozlamalar (operator talab qilsa)'}
        </button>
        {advanced && (
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Port">
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.trunk_port}
                disabled={ro}
                onChange={(e) => set('trunk_port', Number(e.target.value) || 5060)}
              />
            </Field>
            <Field label="Transport">
              <select
                className={selectCls}
                value={form.trunk_transport}
                disabled={ro}
                onChange={(e) => set('trunk_transport', e.target.value as 'udp' | 'tcp')}
              >
                <option value="udp">UDP (odatiy)</option>
                <option value="tcp">TCP</option>
              </select>
            </Field>
            <Field label="Raqam formati (chiquvchi)">
              <select
                className={selectCls}
                value={form.dial_format}
                disabled={ro}
                onChange={(e) =>
                  set('dial_format', e.target.value as PbxTenantInput['dial_format'])
                }
              >
                <option value="digits12">998901234567</option>
                <option value="e164">+998901234567</option>
                <option value="local9">901234567</option>
              </select>
            </Field>
            <Field label="Bir vaqtda chiquvchi (chegara)">
              <Input
                type="number"
                min={1}
                max={50}
                value={form.max_outbound}
                disabled={ro}
                onChange={(e) => set('max_outbound', Number(e.target.value) || 4)}
              />
            </Field>
            <Field label="From domeni (bo‘sh — server bilan bir xil)">
              <Input
                value={form.trunk_from_domain ?? ''}
                disabled={ro}
                onChange={(e) => set('trunk_from_domain', e.target.value.trim() || null)}
              />
            </Field>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            Hech kim olmasa AI javob berishi uchun:{' '}
            <Link to="/settings/ai-reception" className="text-primary underline">
              AI qabulxona
            </Link>{' '}
            rejimi “AI suhbat” yoki “Ovozli xabar” bo‘lsin. Ish vaqti — Sozlamalar → Katalog → Ish
            vaqti.
          </p>
          {canManage && (
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
              Saqlash
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Ichki raqamlar
// ---------------------------------------------------------------------------
type ExtForm = {
  id?: string;
  label: string;
  ext: string;
  profile_id: string | null;
  in_ring_group: boolean;
  can_call_out: boolean;
  is_active: boolean;
};

function ExtensionsCard({ o, canManage }: { o: PbxSettingsOverview; canManage: boolean }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<ExtForm | null>(null);
  const [creds, setCreds] = useState<PbxExtensionCredentials | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'reset'; ext: PbxExtension } | null>(
    null,
  );
  const invalidate = () => qc.invalidateQueries({ queryKey: ['telephony'] });

  const saveExt = useMutation({
    mutationFn: async (f: ExtForm) => {
      if (f.id) {
        await api.telephony.updateExtension(f.id, {
          label: f.label,
          profile_id: f.profile_id,
          in_ring_group: f.in_ring_group,
          can_call_out: f.can_call_out,
          is_active: f.is_active,
        });
        return null;
      }
      return api.telephony.createExtension({
        label: f.label,
        ext: f.ext.trim() || null,
        profile_id: f.profile_id,
        in_ring_group: f.in_ring_group,
        can_call_out: f.can_call_out,
      });
    },
    onSuccess: async (created) => {
      toast.success('Saqlandi');
      setEdit(null);
      invalidate();
      if (created) {
        try {
          setCreds(await api.telephony.extensionCredentials(created.id));
        } catch {
          /* login/parolni keyin ko'rish mumkin */
        }
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const act = useMutation({
    mutationFn: async (c: { kind: 'delete' | 'reset'; ext: PbxExtension }) => {
      if (c.kind === 'delete') {
        await api.telephony.deleteExtension(c.ext.id);
        return null;
      }
      await api.telephony.resetExtensionPassword(c.ext.id);
      return api.telephony.extensionCredentials(c.ext.id);
    },
    onSuccess: (r, c) => {
      setConfirm(null);
      invalidate();
      if (r) setCreds(r);
      toast.success(c.kind === 'delete' ? 'O‘chirildi' : 'Yangi parol yaratildi');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const showCreds = useMutation({
    mutationFn: (id: string) => api.telephony.extensionCredentials(id),
    onSuccess: (r) => setCreds(r),
    onError: (e: Error) => toast.error(e.message),
  });

  const staffName = (id: string | null) =>
    id ? (o.staff.find((s) => s.id === id)?.full_name ?? '—') : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Ichki raqamlar (qabulxona, shifokorlar)</CardTitle>
        {canManage && (
          <Button
            size="sm"
            disabled={!o.tenant}
            title={!o.tenant ? 'Avval yuqoridagi sozlamani saqlang' : undefined}
            onClick={() =>
              setEdit({
                label: '',
                ext: '',
                profile_id: null,
                in_ring_group: true,
                can_call_out: true,
                is_active: true,
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            Qo‘shish
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {o.extensions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Hali ichki raqam yo‘q. Har qabulxona xodimi (yoki stol telefoni) uchun bittadan
            qo‘shing: 201 — Qabulxona, 202 — Kassa va h.k. Xodimni biriktirsangiz, u Clary’ga
            kirganda kompyuteri ham telefon bo‘ladi.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 pr-2">Raqam</th>
                  <th className="py-2 pr-2">Nomi</th>
                  <th className="py-2 pr-2">Xodim (softfon)</th>
                  <th className="py-2 pr-2">Holat</th>
                  <th className="py-2 pr-2">Qoidalar</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {o.extensions.map((e) => (
                  <tr
                    key={e.id}
                    className={cn('border-b last:border-0', !e.is_active && 'opacity-50')}
                  >
                    <td className="py-2 pr-2 font-mono font-semibold">{e.ext}</td>
                    <td className="py-2 pr-2">{e.label}</td>
                    <td className="py-2 pr-2">
                      {e.profile_name ?? staffName(e.profile_id) ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex flex-col gap-0.5 text-xs">
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          <Dot on={e.phone_status === 'online'} /> stol telefoni
                        </span>
                        <span className="flex items-center gap-1">
                          <Monitor className="h-3 w-3" />
                          <Dot on={e.web_status === 'online'} /> Clary softfoni
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-xs">
                      {e.in_ring_group ? 'Jiringlaydi' : 'Jiringlamaydi'}
                      <br />
                      {e.can_call_out ? 'Tashqi: ha' : 'Tashqi: yo‘q'}
                    </td>
                    <td className="py-2 text-right">
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Stol telefoni uchun login/parol"
                            onClick={() => showCreds.mutate(e.id)}
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Tahrirlash"
                            onClick={() =>
                              setEdit({
                                id: e.id,
                                label: e.label,
                                ext: e.ext,
                                profile_id: e.profile_id,
                                in_ring_group: e.in_ring_group,
                                can_call_out: e.can_call_out,
                                is_active: e.is_active,
                              })
                            }
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Parolni yangilash"
                            onClick={() => setConfirm({ kind: 'reset', ext: e })}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="O‘chirish"
                            onClick={() => setConfirm({ kind: 'delete', ext: e })}
                          >
                            <Trash2 className="text-destructive h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {edit && (
        <Dialog open onOpenChange={(v) => !v && setEdit(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{edit.id ? `Ichki raqam ${edit.ext}` : 'Yangi ichki raqam'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Field label="Nomi (telefon ekranida)">
                    <Input
                      value={edit.label}
                      maxLength={40}
                      placeholder="Qabulxona"
                      onChange={(e) => setEdit({ ...edit, label: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Raqam" hint={edit.id ? undefined : 'Bo‘sh — avtomatik (201…)'}>
                  <Input
                    value={edit.ext}
                    disabled={!!edit.id}
                    maxLength={3}
                    inputMode="numeric"
                    placeholder="201"
                    onChange={(e) => setEdit({ ...edit, ext: e.target.value.replace(/\D/g, '') })}
                  />
                </Field>
              </div>
              <Field
                label="Xodim (Clary’ga kirganda kompyuteri shu raqam bilan jiringlaydi)"
                hint="Faqat Clary’ga kira oladigan (login bor) xodimlar"
              >
                <select
                  className={selectCls}
                  value={edit.profile_id ?? ''}
                  onChange={(e) => setEdit({ ...edit, profile_id: e.target.value || null })}
                >
                  <option value="">— faqat stol telefoni —</option>
                  {o.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={edit.in_ring_group}
                  onChange={(e) => setEdit({ ...edit, in_ring_group: e.target.checked })}
                />
                Kiruvchi qo‘ng‘iroqda jiringlasin (qabulxona guruhi)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={edit.can_call_out}
                  onChange={(e) => setEdit({ ...edit, can_call_out: e.target.checked })}
                />
                Tashqi raqamlarga qo‘ng‘iroq qila oladi (faqat O‘zbekiston)
              </label>
              {edit.id && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={edit.is_active}
                    onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })}
                  />
                  Faol
                </label>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEdit(null)}>
                Bekor qilish
              </Button>
              <Button
                disabled={!edit.label.trim() || saveExt.isPending}
                onClick={() => saveExt.mutate(edit)}
              >
                Saqlash
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {creds && <CredentialsDialog creds={creds} onClose={() => setCreds(null)} />}

      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(v) => !v && setConfirm(null)}
          title={
            confirm.kind === 'delete'
              ? `${confirm.ext.ext} — ${confirm.ext.label} o‘chirilsinmi?`
              : `${confirm.ext.ext} uchun yangi parol yaratilsinmi?`
          }
          description={
            confirm.kind === 'delete'
              ? 'Shu raqamdagi telefon va softfon ishlamay qoladi. Qo‘ng‘iroqlar jurnali saqlanadi.'
              : 'Eski parol bilan ulangan stol telefoni uziladi — unga yangi parolni kiritish kerak bo‘ladi.'
          }
          destructive={confirm.kind === 'delete'}
          confirmLabel={confirm.kind === 'delete' ? 'O‘chirish' : 'Yangilash'}
          loading={act.isPending}
          onConfirm={() => act.mutate(confirm)}
        />
      )}
    </Card>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        on ? 'bg-emerald-500' : 'bg-muted-foreground/30',
      )}
    />
  );
}

function CredentialsDialog({
  creds,
  onClose,
}: {
  creds: PbxExtensionCredentials;
  onClose: () => void;
}) {
  const rows: Array<[string, string]> = [
    ['SIP server (Registrar / Proxy)', creds.server ?? '— (server hali sozlanmagan)'],
    ['Port', String(creds.port)],
    ['Transport', creds.transport],
    ['Login (User / Auth ID)', creds.username],
    ['Parol', creds.password ?? '—'],
  ];
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {creds.ext} — {creds.label}: stol telefoni sozlamasi
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {rows.map(([k, v]) => (
            <div
              key={k}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <div>
                <div className="text-muted-foreground text-[11px]">{k}</div>
                <div className="font-mono text-sm">{v}</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => void copy(v)} aria-label="Nusxa">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <p className="text-muted-foreground text-xs">
            IP telefon (Yealink, Fanvil, Grandstream…) veb-panelida: Account → Register Name / User
            Name = login, Password = parol, SIP Server = server. Kompyuterda Clary ochilmasa —
            MicroSIP / Zoiper dasturiga ham shu ma’lumot kiritiladi. Parolni hech kimga yubormang.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Yopish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Qo'llanma
// ---------------------------------------------------------------------------
function HowToCard({ o }: { o: PbxSettingsOverview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Qanday ishlaydi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            Uztelecom’dan <b>IP-telefoniya</b> raqami oling (shartnomada “SIP login/parol, tashqi
            serverdan ro‘yxatdan o‘tish” deb so‘rang). Ular bergan server, login, parolni yuqoriga
            yozing va <b>yoqing</b>.
          </li>
          <li>
            <b>Ichki raqamlar</b> qo‘shing (201 — Qabulxona…). Stol telefoniga 🔑 tugmasidagi
            login/parolni kiriting; xodim biriktirilgan bo‘lsa — u Clary’ga kirganda sarlavhadagi 📞
            belgisi yashil bo‘ladi va kompyuter jiringlaydi (quloqchin + mikrofon kerak).
          </li>
          <li>
            Kiruvchi qo‘ng‘iroq barcha “jiringlaydi” raqamlarda birdan jiringlaydi; kim birinchi
            olsa — o‘sha gaplashadi. {o.tenant?.ring_timeout_sec ?? 20} soniyada hech kim olmasa —
            bemor signaldan keyin ovozli xabar qoldiradi (yoki tanlovga ko‘ra AI qabulxona javob
            beradi). Xabar va qayta qo‘ng‘iroq ro‘yxati — “Qo‘ng‘iroqlar” bo‘limida.
          </li>
          <li>
            Barcha qo‘ng‘iroqlar (kim olgani, o‘tkazib yuborilganlar, yozuv) —{' '}
            <Link to="/calls" className="text-primary underline">
              Qo‘ng‘iroqlar
            </Link>{' '}
            bo‘limida. O‘tkazib yuborilganlarga bir bosishda qayta qo‘ng‘iroq qilinadi.
          </li>
        </ol>
        <p className="text-muted-foreground text-xs">
          Xavfsizlik: chiquvchi qo‘ng‘iroqlar faqat O‘zbekiston raqamlariga (xalqaro yopiq), bir
          vaqtdagi soni cheklangan. 101–104 va 112 favqulodda raqamlar har doim ishlaydi.
        </p>
      </CardContent>
    </Card>
  );
}
