import { Socket } from 'node:net';

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Module,
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
import { SupabaseService } from '../../common/services/supabase.service';

// ============================================================================
// Schemas
// ============================================================================
const PrinterSchema = z.object({
  name: z.string().min(1).max(60),
  connection_type: z.enum(['lan', 'usb', 'bluetooth']),
  ip_address: z.string().nullish(),
  port: z.number().int().min(1).max(65535).default(9100),
  usb_vendor_id: z.string().nullish(),
  usb_product_id: z.string().nullish(),
  bt_mac: z.string().nullish(),
  bt_name: z.string().nullish(),
  paper_width_mm: z.union([z.literal(58), z.literal(80)]).default(80),
  is_default: z.boolean().default(false),
  location: z.string().nullish(),
  notes: z.string().nullish(),
  // Universal kengaytma maydonlari (Bosqich 1)
  has_cutter: z.boolean().default(false),
  has_cash_drawer: z.boolean().default(false),
  purpose: z.enum(['receipt', 'queue', 'report', 'label']).default('receipt'),
  preset_key: z.string().nullish(),
  encoding: z.enum(['CP1251', 'UTF-8', 'CP866']).default('CP1251'),
});

const PrintReceiptSchema = z.object({
  printer_id: z.string().uuid().optional(),  // default printer if missing
  kind: z.enum(['queue_ticket', 'receipt', 'lab_summary', 'rx_summary', 'other']),
  reference_id: z.string().uuid().optional(),
  // Strukturalangan kontent — server ESC/POS bytes ga aylantiradi
  content: z.object({
    header: z.string().optional(),         // klinika nomi
    subheader: z.string().optional(),      // manzil / telefon
    title: z.string().optional(),          // "CHEK" / "NAVBAT"
    lines: z.array(
      z.object({
        text: z.string(),
        align: z.enum(['left', 'center', 'right']).default('left'),
        bold: z.boolean().default(false),
        double: z.boolean().default(false),
      }),
    ).default([]),
    items: z.array(
      z.object({
        name: z.string(),
        qty: z.number().int().optional(),
        amount: z.number().int().optional(),  // UZS
      }),
    ).default([]),
    total_uzs: z.number().int().optional(),
    paid_uzs: z.number().int().optional(),
    debt_uzs: z.number().int().optional(),
    footer: z.string().optional(),
    qr: z.string().optional(),               // QR data (optional)
    cut: z.boolean().default(true),
  }),
});

// ============================================================================
// ESC/POS builder — converts JSON spec to printer bytes
// ============================================================================
const ESC = 0x1b;
const GS = 0x1d;

function escposBytes(width58or80: 58 | 80, content: z.infer<typeof PrintReceiptSchema>['content']): Buffer {
  const cols = width58or80 === 58 ? 32 : 48;
  const out: number[] = [];
  const enc = (s: string): number[] => {
    // CP1251 doesn't cover uz-Latn well; printers usually accept UTF-8 truncated,
    // or CP437/CP866. We send UTF-8 raw — most modern thermal printers handle it
    // for ASCII chars. Cyrillic / extended chars will be replaced with '?'.
    const bytes = Buffer.from(s, 'utf8');
    return Array.from(bytes);
  };
  const push = (...bs: number[]) => out.push(...bs);
  const text = (s: string) => out.push(...enc(s));
  const line = (s: string) => {
    out.push(...enc(s));
    out.push(0x0a);
  };
  const align = (a: 'left' | 'center' | 'right') => {
    push(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
  };
  const bold = (on: boolean) => push(ESC, 0x45, on ? 1 : 0);
  const doubleSize = (on: boolean) => push(GS, 0x21, on ? 0x11 : 0x00);
  const feed = (n = 1) => {
    for (let i = 0; i < n; i++) out.push(0x0a);
  };
  const divider = () => {
    line('-'.repeat(cols));
  };
  const pad = (left: string, right: string): string => {
    const len = left.length + right.length;
    if (len >= cols) return left + ' ' + right;
    return left + ' '.repeat(cols - len) + right;
  };

  // Initialize
  push(ESC, 0x40); // ESC @ — reset

  // Header
  if (content.header) {
    align('center');
    bold(true);
    doubleSize(true);
    line(content.header);
    doubleSize(false);
    bold(false);
  }
  if (content.subheader) {
    align('center');
    line(content.subheader);
  }
  if (content.title) {
    align('center');
    bold(true);
    line(content.title);
    bold(false);
  }
  if (content.header || content.subheader || content.title) divider();

  // Free-form lines
  align('left');
  for (const ln of content.lines) {
    if (ln.align !== 'left') align(ln.align);
    if (ln.bold) bold(true);
    if (ln.double) doubleSize(true);
    line(ln.text);
    if (ln.double) doubleSize(false);
    if (ln.bold) bold(false);
    if (ln.align !== 'left') align('left');
  }

  // Items
  if (content.items.length > 0) {
    divider();
    for (const it of content.items) {
      const right = it.amount != null ? `${it.amount.toLocaleString('uz-UZ')}` : '';
      const left = it.qty != null && it.qty !== 1 ? `${it.name} x${it.qty}` : it.name;
      line(pad(left, right));
    }
    divider();
  }

  // Totals
  if (content.total_uzs != null) {
    bold(true);
    line(pad('JAMI:', `${content.total_uzs.toLocaleString('uz-UZ')} UZS`));
    bold(false);
  }
  if (content.paid_uzs != null) {
    line(pad("To'langan:", `${content.paid_uzs.toLocaleString('uz-UZ')}`));
  }
  if (content.debt_uzs != null && content.debt_uzs > 0) {
    line(pad('Qarz:', `${content.debt_uzs.toLocaleString('uz-UZ')}`));
  }

  // QR (GS ( k — model 2). Chekdagi havola: bemor skaner qilib chekni onlayn ochadi.
  // Eski printerlar QR buyrug'ini bilmasa e'tiborsiz qoldiradi — chek buzilmaydi.
  if (content.qr) {
    const data = Buffer.from(content.qr, 'ascii');
    const storeLen = data.length + 3;
    feed(1);
    align('center');
    push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // model 2
    push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06);       // module size 6
    push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);       // EC level M
    push(GS, 0x28, 0x6b, storeLen & 0xff, (storeLen >> 8) & 0xff, 0x31, 0x50, 0x30);
    out.push(...Array.from(data));
    push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);       // print
    line('Chekni onlayn tekshirish: QR skaner qiling');
    align('left');
  }

  // Footer
  if (content.footer) {
    feed(1);
    align('center');
    line(content.footer);
  }

  feed(3);

  // Cut paper (full cut GS V 0, partial GS V 1)
  if (content.cut) {
    push(GS, 0x56, 0x01);
  }

  return Buffer.from(out);
}

// ============================================================================
// Service
// ============================================================================
@Injectable()
export class ThermalPrintersService {
  private readonly log = new Logger('ThermalPrinters');

  constructor(private readonly supabase: SupabaseService) {}

  async list(clinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('thermal_printers')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsert(clinicId: string, input: z.infer<typeof PrinterSchema>, id?: string) {
    if (input.connection_type === 'lan' && !input.ip_address) {
      throw new BadRequestException('LAN printer uchun IP manzil kerak');
    }
    const admin = this.supabase.admin();
    // If marking this as default, unset others ONLY for the same purpose
    // (per-purpose default — unique partial index thermal_printers_default_per_purpose_idx).
    if (input.is_default) {
      await admin
        .from('thermal_printers')
        .update({ is_default: false })
        .eq('clinic_id', clinicId)
        .eq('purpose', input.purpose);
    }
    const payload = { clinic_id: clinicId, ...input };
    const q = id
      ? admin.from('thermal_printers').update(payload).eq('clinic_id', clinicId).eq('id', id)
      : admin.from('thermal_printers').insert(payload);
    const { data, error } = await q.select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async defaultByPurpose(clinicId: string, purpose: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('thermal_printers')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('purpose', purpose)
      .eq('is_default', true)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('thermal_printers')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async print(
    clinicId: string,
    userId: string | null,
    input: z.infer<typeof PrintReceiptSchema>,
  ) {
    const admin = this.supabase.admin();
    // Resolve printer: explicit id or default
    type PrinterRow = {
      id: string;
      connection_type: string;
      ip_address: string | null;
      port: number;
      paper_width_mm: number;
      name: string;
    };
    let printer: PrinterRow | null = null;
    if (input.printer_id) {
      const { data } = await admin
        .from('thermal_printers')
        .select('id, connection_type, ip_address, port, paper_width_mm, name')
        .eq('clinic_id', clinicId)
        .eq('id', input.printer_id)
        .maybeSingle();
      printer = data as PrinterRow | null;
    } else {
      const { data } = await admin
        .from('thermal_printers')
        .select('id, connection_type, ip_address, port, paper_width_mm, name')
        .eq('clinic_id', clinicId)
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();
      printer = data as PrinterRow | null;
    }
    if (!printer) {
      throw new BadRequestException(
        'Klinika thermal printer sozlanmagan. Sozlamalar → Printerlar bo‘limidan qo‘shing.',
      );
    }

    // Log job (pending)
    const { data: jobData } = await admin
      .from('print_jobs')
      .insert({
        clinic_id: clinicId,
        printer_id: printer.id,
        kind: input.kind,
        reference_id: input.reference_id ?? null,
        payload: input.content,
        status: 'pending',
        triggered_by: userId,
      })
      .select('id')
      .single();
    const jobId = (jobData as { id: string } | null)?.id;

    if (printer.connection_type !== 'lan' || !printer.ip_address) {
      // USB/Bluetooth: server can't reach the printer directly.
      // Mark job 'pending' — a future bridge agent will pick it up.
      return {
        ok: true,
        job_id: jobId,
        status: 'queued_for_agent',
        message: 'USB/Bluetooth printer uchun agent kerak (keyingi sprint)',
      };
    }

    // LAN: open TCP socket, send raw ESC/POS bytes
    const bytes = escposBytes(printer.paper_width_mm as 58 | 80, input.content);
    try {
      await this.sendRawTcp(printer.ip_address, printer.port, bytes);
      if (jobId) {
        await admin
          .from('print_jobs')
          .update({ status: 'sent', printed_at: new Date().toISOString() })
          .eq('id', jobId);
      }
      return { ok: true, job_id: jobId, status: 'sent' };
    } catch (e) {
      const errMsg = (e as Error).message;
      if (jobId) {
        await admin
          .from('print_jobs')
          .update({ status: 'failed', error: errMsg })
          .eq('id', jobId);
      }
      throw new BadRequestException(`Printer ${printer.name}: ${errMsg}`);
    }
  }

  private sendRawTcp(host: string, port: number, bytes: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const timeout = 5000;
      socket.setTimeout(timeout);
      socket.once('error', (err) => {
        socket.destroy();
        reject(err);
      });
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error(`Printer timeout (${host}:${port})`));
      });
      socket.connect(port, host, () => {
        socket.write(bytes, (err) => {
          if (err) {
            socket.destroy();
            reject(err);
            return;
          }
          socket.end(() => resolve());
        });
      });
    });
  }
}

// ============================================================================
// Controller
// ============================================================================
@ApiTags('thermal-printers')
@Controller('thermal-printers')
class ThermalPrintersController {
  constructor(private readonly svc: ThermalPrintersService) {}

  @Get()
  list(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.list(u.clinicId);
  }

  @Get('default')
  defaultByPurpose(
    @CurrentUser() u: { clinicId: string | null },
    @Query('purpose') purpose?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const p = purpose ?? 'receipt';
    if (!['receipt', 'queue', 'report', 'label'].includes(p)) {
      throw new BadRequestException('Invalid purpose');
    }
    return this.svc.defaultByPurpose(u.clinicId, p);
  }

  @Post()
  @Audit({ action: 'printer.created', resourceType: 'thermal_printers' })
  create(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.upsert(u.clinicId, PrinterSchema.parse(body));
  }

  @Patch(':id')
  @Audit({ action: 'printer.updated', resourceType: 'thermal_printers' })
  update(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.upsert(u.clinicId, PrinterSchema.parse(body), id);
  }

  @Patch(':id/delete')
  @Audit({ action: 'printer.deleted', resourceType: 'thermal_printers' })
  remove(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.remove(u.clinicId, id);
  }

  @Post('print')
  @Audit({ action: 'printer.print_job', resourceType: 'print_jobs' })
  print(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.print(u.clinicId, u.userId, PrintReceiptSchema.parse(body));
  }
}

@Module({
  controllers: [ThermalPrintersController],
  providers: [ThermalPrintersService, SupabaseService],
  exports: [ThermalPrintersService],
})
export class ThermalPrintersModule {}
