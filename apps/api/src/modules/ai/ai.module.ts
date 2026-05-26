import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Module,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// Anthropic Claude integratsiya — kichik xarajat, qisqa javoblar.
// Model: claude-haiku-4-5 (eng arzon va eng tez).
// Rate limit: har klinika kuniga 100 chaqiruv (in-memory).

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 500;
const RATE_LIMIT_PER_CLINIC_PER_DAY = 100;

// In-memory rate limiter — har klinika uchun bugungi chaqiruvlar soni.
const callCounters = new Map<string, { count: number; date: string }>();

function checkRateLimit(clinicId: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const cur = callCounters.get(clinicId);
  if (!cur || cur.date !== today) {
    callCounters.set(clinicId, { count: 1, date: today });
    return;
  }
  if (cur.count >= RATE_LIMIT_PER_CLINIC_PER_DAY) {
    throw new ServiceUnavailableException(
      `Kunlik AI chaqiruvlar limiti tugadi (${RATE_LIMIT_PER_CLINIC_PER_DAY}). Ertaga qaytaring.`,
    );
  }
  cur.count += 1;
}

@Injectable()
class AiService {
  private readonly log = new Logger(AiService.name);
  private readonly client: Anthropic | null;

  constructor(private readonly supabase: SupabaseService) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.log.warn('ANTHROPIC_API_KEY o\'rnatilmagan — AI funksiyalari ishlamaydi');
      this.client = null;
    } else {
      this.client = new Anthropic({ apiKey });
    }
  }

  private requireClient(): Anthropic {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'AI xizmat sozlanmagan. Admin ANTHROPIC_API_KEY ni qo\'shishi kerak.',
      );
    }
    return this.client;
  }

  // Bugungi insight — KPI ma'lumotlarini Claude'ga yuborib, 3 jumlali tavsiya olamiz.
  async dailyInsight(clinicId: string): Promise<{ lines: string[]; cached: boolean }> {
    const client = this.requireClient();
    checkRateLimit(clinicId);

    const admin = this.supabase.admin();
    // KPI ma'lumotlarini yig'amiz (oddiy queries)
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const [todayTxRes, yesterdayTxRes, anomaliesRes, openShiftsRes, atRiskRes] = await Promise.all([
      admin
        .from('transactions')
        .select('amount_uzs, kind')
        .eq('clinic_id', clinicId)
        .eq('is_void', false)
        .gte('created_at', todayStart.toISOString()),
      admin
        .from('transactions')
        .select('amount_uzs, kind')
        .eq('clinic_id', clinicId)
        .eq('is_void', false)
        .gte('created_at', yesterdayStart.toISOString())
        .lt('created_at', todayStart.toISOString()),
      admin
        .from('shift_cash_anomaly_view')
        .select('id, abs_diff, anomaly_level')
        .eq('clinic_id', clinicId)
        .in('anomaly_level', ['high_anomaly', 'medium_anomaly'])
        .gte('closed_at', new Date(now.getTime() - 7 * 86_400_000).toISOString()),
      admin
        .from('shifts')
        .select('id')
        .eq('clinic_id', clinicId)
        .is('closed_at', null),
      admin
        .from('patient_segments_view')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('churn_segment', 'at_risk'),
    ]);

    const sumRows = (rows: unknown[]): number =>
      rows.reduce<number>((s, r) => {
        const row = r as { amount_uzs: number; kind: string };
        return s + (row.kind === 'refund' ? -1 : 1) * Number(row.amount_uzs ?? 0);
      }, 0);
    const todayRevenue = sumRows(todayTxRes.data ?? []);
    const yesterdayRevenue = sumRows(yesterdayTxRes.data ?? []);
    const txCount = (todayTxRes.data ?? []).length;
    const anomaliesCount = (anomaliesRes.data ?? []).length;
    const openShifts = (openShiftsRes.data ?? []).length;
    const atRiskCount = atRiskRes.count ?? 0;

    const prompt = `Sen klinika rahbari uchun assistent san. Quyidagi bugungi ko'rsatkichlar asosida 3 ta qisqa harakat tavsiyasi ber (O'zbek tilida, har biri 1 jumla, aniq va amaliy).

Bugungi ko'rsatkichlar:
- Tushum bugun: ${todayRevenue.toLocaleString('uz-UZ')} so'm
- Tushum kechagi: ${yesterdayRevenue.toLocaleString('uz-UZ')} so'm
- Bugungi tx soni: ${txCount}
- So'nggi 7 kun anomaliyalari: ${anomaliesCount} ta
- Ochiq smena: ${openShifts}
- Yo'qolish xavfida bemorlar: ${atRiskCount} ta

Format: faqat 3 ta gap, har biri yangi qatorda, oldidan "•" belgisi bilan. Boshqa hech narsa yozma. Eng muhim narsalarni ayt.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('\n');

    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('•') || l.startsWith('-'))
      .map((l) => l.replace(/^[•-]\s*/, ''))
      .slice(0, 5);

    return { lines, cached: false };
  }

  // ICD-10 kod tavsiya — shifokor matnli tashxis yozsa, top 3 kod.
  async icd10Suggest(
    clinicId: string,
    diagnosisText: string,
  ): Promise<{ suggestions: Array<{ code: string; description: string }> }> {
    const client = this.requireClient();
    checkRateLimit(clinicId);

    if (diagnosisText.trim().length < 3) {
      throw new BadRequestException('Tashxis matni kamida 3 belgi bo\'lishi kerak');
    }

    const prompt = `Quyidagi tashxis matni uchun ICD-10 kodlari taklif qil (top 3, eng aniq birinchi):

Tashxis: "${diagnosisText}"

Format (faqat JSON, boshqa hech narsa):
[
  {"code": "K25.0", "description": "Oshqozonning o'tkir yarasi"},
  {"code": "K25.9", "description": "Aniqlanmagan o'tkir yara"},
  {"code": "K26.0", "description": "12 barmoqli ichakning o'tkir yarasi"}
]`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('');

    // JSON ni topib parse qilamiz
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return { suggestions: [] };
    }
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{ code: string; description: string }>;
      return { suggestions: parsed.slice(0, 5) };
    } catch {
      return { suggestions: [] };
    }
  }
}

@ApiTags('ai')
@Controller({ path: 'ai', version: '1' })
class AiController {
  constructor(private readonly svc: AiService) {}

  // Dashboard'da AI Insight widget
  @Get('daily-insight')
  dailyInsight(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.dailyInsight(u.clinicId);
  }

  // Doctor workspace'da tashxis yozayotganda
  @Post('icd10-suggest')
  icd10(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    const schema = z.object({ diagnosis: z.string().min(3).max(500) });
    const { diagnosis } = schema.parse(body);
    return this.svc.icd10Suggest(u.clinicId, diagnosis);
  }
}

@Module({
  controllers: [AiController],
  providers: [AiService, SupabaseService],
  exports: [AiService],
})
export class AiModule {}
