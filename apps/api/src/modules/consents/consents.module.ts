import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';
import {
  CONSENT_CODES,
  CONSENT_LANGS,
  DEFAULT_TEMPLATES,
  PLACEHOLDERS,
  type ConsentCode,
  type ConsentLang,
} from './consent-defaults';
import { fmtConsentDate, joinParts, renderConsentBody } from './consent-render';

// =============================================================================
// INFORMED CONSENT — bemorning tibbiy aralashuvga yozma roziligi
// =============================================================================
// Oqim: shablon → chop etish (matn SNAPSHOT bilan muzlatiladi) → bemor qo'lda
// imzolaydi → skan yuklanadi → 'signed'.
//
// MUHIM QARORLAR:
// 1. body_snapshot RENDER QILINGAN matnni saqlaydi (placeholder'lar allaqachon
//    almashtirilgan) — chunki bemor aynan shu qog'ozni imzolagan. Shablon keyin
//    o'zgarsa ham imzolangan hujjat tegilmaydi.
// 2. HARD DELETE YO'Q. Rozilik — huquqiy hujjat; noto'g'ri bo'lsa 'revoked'
//    qilinadi (sabab bilan), o'chirilmaydi.
// 3. Skanlar private bucket'da; o'qish faqat qisqa muddatli signed URL orqali.
// =============================================================================

const SIGNED_URL_TTL_SEC = 3600;
const CONSENTS_BUCKET = 'patient-consents';

const TemplateCreateSchema = z.object({
  code: z.enum(CONSENT_CODES),
  lang: z.enum(CONSENT_LANGS).default('uz'),
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(20000),
});

const TemplateUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  body: z.string().min(1).max(20000).optional(),
  is_active: z.boolean().optional(),
});

const ConsentCreateSchema = z.object({
  patient_id: z.string().uuid(),
  code: z.enum(CONSENT_CODES),
  lang: z.enum(CONSENT_LANGS).default('uz'),
  // Kontekst — ixtiyoriy, hujjatni voqeaga bog'laydi.
  stay_id: z.string().uuid().nullish(),
  dental_plan_id: z.string().uuid().nullish(),
  appointment_id: z.string().uuid().nullish(),
  // Render uchun qo'shimcha qiymatlar.
  doctor_id: z.string().uuid().nullish(),
  doctor_name: z.string().max(300).nullish(),
  procedure: z.string().max(1000).nullish(),
  // Bemor o'zi imzolamasa (14 yoshgacha / muomalaga layoqatsiz).
  signer_name: z.string().max(300).nullish(),
  signer_relation: z.enum(['self', 'parent', 'guardian']).default('self'),
});

const SignSchema = z.object({
  signer_name: z.string().max(300).nullish(),
  signer_relation: z.enum(['self', 'parent', 'guardian']).optional(),
  // Skan (ixtiyoriy — qog'oz papkada saqlanishi ham mumkin).
  storage_path: z.string().max(500).nullish(),
  file_name: z.string().max(300).nullish(),
  mime_type: z.string().max(120).nullish(),
  size_bytes: z.number().int().nonnegative().nullish(),
  notes: z.string().max(2000).nullish(),
});

const RefuseSchema = z.object({ notes: z.string().max(2000).nullish() });
const RevokeSchema = z.object({ reason: z.string().min(3).max(2000) });

@Injectable()
export class ConsentsService {
  constructor(private readonly supabase: SupabaseService) {}

  // ---------------------------------------------------------------- shablon

  /**
   * Klinika shablonlari. Bo'sh bo'lsa default matnlar bir marta nusxalanadi
   * (lazy seed) — klinika keyin ularni o'zi tahrirlaydi.
   */
  async listTemplates(clinicId: string) {
    const admin = this.supabase.admin();
    const sel = 'id, code, lang, title, body, version, is_active, created_at, updated_at';
    const { data, error } = await admin
      .from('consent_templates')
      .select(sel)
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('code');
    if (error) throw new BadRequestException(error.message);
    if ((data ?? []).length > 0) return { templates: data, placeholders: PLACEHOLDERS };

    // Birinchi ochilish — defaultlarni nusxalash.
    const rows = DEFAULT_TEMPLATES.map((t) => ({
      clinic_id: clinicId,
      code: t.code,
      lang: t.lang,
      title: t.title,
      body: t.body,
    }));
    // Ikki xodim bir vaqtda ochsa unique indeks ikkinchisini rad etadi — bu
    // xato emas, shunchaki qayta o'qiymiz.
    await admin
      .from('consent_templates')
      .insert(rows as never)
      .select('id');
    const { data: seeded } = await admin
      .from('consent_templates')
      .select(sel)
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('code');
    return { templates: seeded ?? [], placeholders: PLACEHOLDERS };
  }

  async createTemplate(
    clinicId: string,
    userId: string | null,
    input: z.infer<typeof TemplateCreateSchema>,
  ) {
    const admin = this.supabase.admin();
    // Bitta kod+til uchun bitta faol shablon — eskisini arxivlaymiz.
    await admin
      .from('consent_templates')
      .update({ is_active: false })
      .eq('clinic_id', clinicId)
      .eq('code', input.code)
      .eq('lang', input.lang)
      .eq('is_active', true);
    const { data, error } = await admin
      .from('consent_templates')
      .insert({
        clinic_id: clinicId,
        code: input.code,
        lang: input.lang,
        title: input.title,
        body: input.body,
        created_by: userId,
      } as never)
      .select('id, code, lang, title, body, version, is_active')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * Matn o'zgarsa — YANGI VERSIYA yoziladi, eskisi arxivlanadi (o'zgarish
   * tarixi saqlanadi). Faqat is_active almashsa — joyida yangilanadi.
   */
  async updateTemplate(
    clinicId: string,
    userId: string | null,
    id: string,
    input: z.infer<typeof TemplateUpdateSchema>,
  ) {
    const admin = this.supabase.admin();
    const { data: cur } = await admin
      .from('consent_templates')
      .select('id, code, lang, title, body, version, is_active')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (!cur) throw new NotFoundException('Shablon topilmadi');
    const t = cur as {
      code: ConsentCode;
      lang: ConsentLang;
      title: string;
      body: string;
      version: number;
      is_active: boolean;
    };

    const textChanged =
      (input.title !== undefined && input.title !== t.title) ||
      (input.body !== undefined && input.body !== t.body);

    if (!textChanged) {
      const { data, error } = await admin
        .from('consent_templates')
        .update({ is_active: input.is_active ?? t.is_active })
        .eq('clinic_id', clinicId)
        .eq('id', id)
        .select('id, code, lang, title, body, version, is_active')
        .single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }

    // Unique indeks (clinic, code, lang) WHERE is_active — avval eskisini
    // arxivlaymiz, keyin yangisini yozamiz. Yozish yiqilsa eskisini tiklaymiz,
    // aks holda klinika faol shablonsiz qolib ketadi.
    await admin
      .from('consent_templates')
      .update({ is_active: false })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    const { data, error } = await admin
      .from('consent_templates')
      .insert({
        clinic_id: clinicId,
        code: t.code,
        lang: t.lang,
        title: input.title ?? t.title,
        body: input.body ?? t.body,
        version: Number(t.version ?? 1) + 1,
        created_by: userId,
      } as never)
      .select('id, code, lang, title, body, version, is_active')
      .single();
    if (error) {
      await admin
        .from('consent_templates')
        .update({ is_active: true })
        .eq('clinic_id', clinicId)
        .eq('id', id);
      throw new BadRequestException(error.message);
    }
    return data;
  }

  // --------------------------------------------------------------- rozilik

  private readonly SELECT =
    'id, patient_id, template_id, code, lang, title_snapshot, body_snapshot, template_version, ' +
    'stay_id, dental_plan_id, appointment_id, status, signer_name, signer_relation, ' +
    'signed_at, refused_at, revoked_at, revoke_reason, storage_path, file_name, mime_type, ' +
    'size_bytes, notes, created_at, patient:patients(id, full_name)';

  /** Skanlar private — ro'yxatga qisqa muddatli signed URL biriktiramiz. */
  private async withSignedUrls<T extends { storage_path: string | null }>(
    rows: T[],
  ): Promise<Array<T & { signed_url: string | null }>> {
    const paths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
    if (paths.length === 0) return rows.map((r) => ({ ...r, signed_url: null }));
    const { data: signed } = await this.supabase
      .admin()
      .storage.from(CONSENTS_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SEC);
    const byPath = new Map<string, string>();
    for (const s of (signed ?? []) as Array<{ path: string | null; signedUrl: string }>) {
      if (s.path && s.signedUrl) byPath.set(s.path, s.signedUrl);
    }
    return rows.map((r) => ({
      ...r,
      signed_url: r.storage_path ? (byPath.get(r.storage_path) ?? null) : null,
    }));
  }

  async list(clinicId: string, opts: { patientId?: string; status?: string }) {
    const admin = this.supabase.admin();
    let q = admin.from('patient_consents').select(this.SELECT).eq('clinic_id', clinicId);
    if (opts.patientId) q = q.eq('patient_id', opts.patientId);
    if (opts.status) q = q.eq('status', opts.status);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
    if (error) throw new BadRequestException(error.message);
    return this.withSignedUrls((data ?? []) as unknown as Array<{ storage_path: string | null }>);
  }

  async getOne(clinicId: string, id: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('patient_consents')
      .select(this.SELECT)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Rozilik topilmadi');
    const [row] = await this.withSignedUrls([data as unknown as { storage_path: string | null }]);
    return row;
  }

  /**
   * Rozilik hujjatini yaratish — shablonni olib, placeholder'larni to'ldirib,
   * natijani SNAPSHOT sifatida yozadi. Frontend qaytgan `body_snapshot`ni
   * chop etadi (ya'ni chop etilgan qog'oz = bazadagi matn, aynan bir xil).
   */
  async create(
    clinicId: string,
    userId: string | null,
    input: z.infer<typeof ConsentCreateSchema>,
  ) {
    const admin = this.supabase.admin();

    // 1) Shablon (kerak bo'lsa defaultlar seed qilinadi)
    await this.listTemplates(clinicId);
    const { data: tpl } = await admin
      .from('consent_templates')
      .select('id, title, body, version')
      .eq('clinic_id', clinicId)
      .eq('code', input.code)
      .eq('lang', input.lang)
      .eq('is_active', true)
      .maybeSingle();
    if (!tpl) {
      throw new BadRequestException(
        `Shablon topilmadi (${input.code}/${input.lang}) — Sozlamalar > Roziliklar bo'limida yarating`,
      );
    }
    const t = tpl as { id: string; title: string; body: string; version: number };

    // 2) Render uchun ma'lumotlar
    const [patientRes, clinicRes, doctorRes] = await Promise.all([
      admin
        .from('patients')
        .select('id, full_name, dob, phone, address, city, region, id_type, id_number')
        .eq('clinic_id', clinicId)
        .eq('id', input.patient_id)
        .maybeSingle(),
      admin
        .from('clinics')
        .select('name, address, city, region, phone')
        .eq('id', clinicId)
        .maybeSingle(),
      input.doctor_id
        ? admin.from('profiles').select('full_name').eq('id', input.doctor_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const p = patientRes.data as {
      full_name: string;
      dob: string | null;
      phone: string | null;
      address: string | null;
      city: string | null;
      region: string | null;
      id_type: string | null;
      id_number: string | null;
    } | null;
    if (!p) throw new NotFoundException('Bemor topilmadi');
    const c = clinicRes.data as {
      name: string;
      address: string | null;
      city: string | null;
      region: string | null;
      phone: string | null;
    } | null;
    const doctorName =
      input.doctor_name ?? (doctorRes.data as { full_name: string | null } | null)?.full_name ?? '';

    const vars: Record<string, string> = {
      bemor_fio: p.full_name ?? '',
      tugilgan_sana: fmtConsentDate(p.dob),
      bemor_manzil: joinParts([p.address, p.city, p.region]),
      bemor_telefon: p.phone ?? '',
      bemor_hujjat: joinParts([p.id_type, p.id_number], ' '),
      klinika: c?.name ?? '',
      klinika_manzil: joinParts([c?.address, c?.city, c?.region]),
      klinika_telefon: c?.phone ?? '',
      shifokor: doctorName,
      muolaja: input.procedure ?? '',
      sana: fmtConsentDate(new Date().toISOString()),
      // Vasiy imzolasa uning ismi, aks holda bemorning o'zi.
      imzolovchi: input.signer_name ?? p.full_name ?? '',
    };

    const { data, error } = await admin
      .from('patient_consents')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        template_id: t.id,
        code: input.code,
        lang: input.lang,
        title_snapshot: t.title,
        body_snapshot: renderConsentBody(t.body, vars),
        template_version: t.version,
        stay_id: input.stay_id ?? null,
        dental_plan_id: input.dental_plan_id ?? null,
        appointment_id: input.appointment_id ?? null,
        signer_name: input.signer_name ?? null,
        signer_relation: input.signer_relation,
        created_by: userId,
      } as never)
      .select(this.SELECT)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Bemor imzoladi. Skan ixtiyoriy — qog'oz papkada qolishi ham mumkin. */
  async sign(
    clinicId: string,
    userId: string | null,
    id: string,
    input: z.infer<typeof SignSchema>,
  ) {
    const admin = this.supabase.admin();
    const cur = await this.requireEditable(clinicId, id);
    const patch: Record<string, unknown> = {
      status: 'signed',
      signed_at: new Date().toISOString(),
    };
    if (input.signer_name !== undefined) patch.signer_name = input.signer_name;
    if (input.signer_relation) patch.signer_relation = input.signer_relation;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.storage_path) {
      patch.storage_path = input.storage_path;
      patch.file_name = input.file_name ?? null;
      patch.mime_type = input.mime_type ?? null;
      patch.size_bytes = input.size_bytes ?? null;
      patch.uploaded_by = userId;
    }
    const { data, error } = await admin
      .from('patient_consents')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', cur.id)
      .select(this.SELECT)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Bemor bosh tortdi — bu ham huquqiy fakt, o'chirilmaydi. */
  async refuse(clinicId: string, id: string, input: z.infer<typeof RefuseSchema>) {
    const cur = await this.requireEditable(clinicId, id);
    const { data, error } = await this.supabase
      .admin()
      .from('patient_consents')
      .update({
        status: 'refused',
        refused_at: new Date().toISOString(),
        notes: input.notes ?? null,
      })
      .eq('clinic_id', clinicId)
      .eq('id', cur.id)
      .select(this.SELECT)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Bemor rozilikni qaytarib oldi (qonuniy huquqi). Sabab majburiy. */
  async revoke(clinicId: string, id: string, input: z.infer<typeof RevokeSchema>) {
    const admin = this.supabase.admin();
    const { data: cur } = await admin
      .from('patient_consents')
      .select('id, status')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (!cur) throw new NotFoundException('Rozilik topilmadi');
    if ((cur as { status: string }).status === 'revoked') {
      throw new BadRequestException('Bu rozilik allaqachon qaytarib olingan');
    }
    const { data, error } = await admin
      .from('patient_consents')
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoke_reason: input.reason,
      })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select(this.SELECT)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Qaytarib olingan hujjatni qayta imzolangan/bosh tortilgan qilib bo'lmaydi. */
  private async requireEditable(clinicId: string, id: string): Promise<{ id: string }> {
    const { data } = await this.supabase
      .admin()
      .from('patient_consents')
      .select('id, status')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (!data) throw new NotFoundException('Rozilik topilmadi');
    const row = data as { id: string; status: string };
    if (row.status === 'revoked') {
      throw new BadRequestException("Qaytarib olingan rozilikni o'zgartirib bo'lmaydi");
    }
    return row;
  }
}

@ApiTags('consents')
@Controller({ path: 'consents', version: '1' })
class ConsentsController {
  constructor(private readonly svc: ConsentsService) {}

  // ---- Shablonlar ----------------------------------------------------------

  @Get('templates')
  templates(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listTemplates(u.clinicId);
  }

  @Post('templates')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'consent.template.created', resourceType: 'consent_templates' })
  createTemplate(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.createTemplate(u.clinicId, u.userId ?? null, TemplateCreateSchema.parse(body));
  }

  @Patch('templates/:id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'consent.template.updated', resourceType: 'consent_templates' })
  updateTemplate(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateTemplate(
      u.clinicId,
      u.userId ?? null,
      id,
      TemplateUpdateSchema.parse(body),
    );
  }

  // ---- Roziliklar ----------------------------------------------------------

  @Get()
  list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('patient_id') patientId?: string,
    @Query('status') status?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.list(u.clinicId, { patientId, status });
  }

  @Get(':id')
  getOne(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getOne(u.clinicId, id);
  }

  @Post()
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'receptionist', 'doctor', 'nurse')
  @Audit({ action: 'consent.created', resourceType: 'patient_consents' })
  create(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.create(u.clinicId, u.userId ?? null, ConsentCreateSchema.parse(body));
  }

  @Patch(':id/sign')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'receptionist', 'doctor', 'nurse')
  @Audit({ action: 'consent.signed', resourceType: 'patient_consents' })
  sign(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.sign(u.clinicId, u.userId ?? null, id, SignSchema.parse(body));
  }

  @Patch(':id/refuse')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin', 'receptionist', 'doctor', 'nurse')
  @Audit({ action: 'consent.refused', resourceType: 'patient_consents' })
  refuse(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.refuse(u.clinicId, id, RefuseSchema.parse(body));
  }

  @Patch(':id/revoke')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'consent.revoked', resourceType: 'patient_consents' })
  revoke(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.revoke(u.clinicId, id, RevokeSchema.parse(body));
  }
}

@Module({
  controllers: [ConsentsController],
  providers: [ConsentsService, SupabaseService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
