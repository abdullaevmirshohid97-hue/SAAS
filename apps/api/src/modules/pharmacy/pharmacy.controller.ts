import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  PharmacyAdmin,
  PharmacyCapability,
} from '../../common/decorators/pharmacy-workspace.decorator';
import { RequireAnyPerm, RequirePerm } from '../../common/decorators/require-perm.decorator';
import { TrashService } from '../trash/trash.module';
import { PharmacyService } from './pharmacy.service';
import {
  BarcodeSchema,
  BulkMedicationSchema,
  ClinicPaymentSchema,
  DuplicateCheckSchema,
  ImportMatchSchema,
  ImportProfileSchema,
  MedCategorySchema,
  MedicationSchema,
  MedicationUpdateSchema,
  PackSizeSchema,
  PharmClinicSchema,
  PharmDoctorSchema,
  QuickButtonsSchema,
  ReceiptDraftSchema,
  ReceiptSchema,
  SaleSchema,
  SupplierEntrySchema,
  SupplierPaymentSchema,
  SupplierSchema,
  SupplierUpdateSchema,
  VoidSaleSchema,
} from './pharmacy.schemas';

type U = { clinicId: string | null; userId: string | null };

function need(u: U): { clinicId: string; userId: string } {
  if (!u.clinicId || !u.userId) throw new ForbiddenException();
  return { clinicId: u.clinicId, userId: u.userId };
}

// Ruxsatlar (klinika foydalanuvchilari uchun). Alohida dorixona kirishida
// huquq PIN operatordan keladi (@PharmacyAdmin / @PharmacyCapability).
const VIEW = ['pharmacy.view', 'medications.view'] as const;

@ApiTags('pharmacy')
@Controller({ path: 'pharmacy', version: '1' })
export class PharmacyController {
  constructor(
    private readonly svc: PharmacyService,
    private readonly trash: TrashService,
  ) {}

  @Get('dashboard')
  @RequireAnyPerm(...VIEW)
  dashboard(@CurrentUser() u: U) {
    return this.svc.dashboard(need(u).clinicId);
  }

  // Qidiruv: dorixonachi, qabulxona "Dori bilan", shifokor retsepti
  @Get('medications/search')
  @RequireAnyPerm(
    'pharmacy.view',
    'medications.view',
    'cashier.accept_payment',
    'prescriptions.create',
  )
  search(@CurrentUser() u: U, @Query('q') q?: string) {
    return this.svc.searchMedications(need(u).clinicId, q);
  }

  /** POS katalogi — brauzerda tez qidiruv va skaner uchun. */
  @Get('pos/catalog')
  @RequireAnyPerm('pharmacy.view', 'pharmacy.dispense', 'cashier.accept_payment')
  posCatalog(@CurrentUser() u: U) {
    return this.svc.posCatalog(need(u).clinicId);
  }

  /** Sotuv oynasining tezkor tugmalari — barcha kassalarda bir xil. */
  @Get('quick-buttons')
  @RequireAnyPerm('pharmacy.view', 'pharmacy.dispense', 'cashier.accept_payment')
  quickButtons(@CurrentUser() u: U) {
    return this.svc.getQuickButtons(need(u).clinicId);
  }

  @Put('quick-buttons')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin', 'pharmacist')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.quick_buttons_saved', resourceType: 'clinics' })
  saveQuickButtons(@CurrentUser() u: U, @Body() body: unknown) {
    return this.svc.saveQuickButtons(need(u).clinicId, QuickButtonsSchema.parse(body));
  }

  /** Skaner kodi tahlili (EAN / QR / GS1 DataMatrix) + dori. */
  @Get('lookup')
  @RequireAnyPerm('pharmacy.view', 'medications.view', 'cashier.accept_payment')
  lookup(@CurrentUser() u: U, @Query('code') code: string) {
    return this.svc.lookup(need(u).clinicId, String(code ?? ''));
  }

  @Get('medications/barcode/:code')
  @RequireAnyPerm('pharmacy.view', 'medications.view', 'cashier.accept_payment')
  findByBarcode(@CurrentUser() u: U, @Param('code') code: string) {
    return this.svc.findByBarcode(need(u).clinicId, code);
  }

  @Post('medications/import-csv')
  @RequireAnyPerm('medications.create')
  @PharmacyAdmin()
  importCsv(@CurrentUser() u: U, @Body() body: { rows: unknown[] }) {
    const { clinicId, userId } = need(u);
    const ImportRowSchema = z.object({
      name: z.string().min(1),
      barcode: z.string().optional(),
      manufacturer: z.string().optional(),
      strength: z.string().optional(),
      form: z.string().optional(),
      price_uzs: z.number().int().nonnegative(),
      cost_uzs: z.number().int().nonnegative().optional(),
      reorder_level: z.number().int().nonnegative().optional(),
    });
    const rows = z
      .array(ImportRowSchema)
      .max(5000)
      .parse(body.rows ?? []);
    return this.svc.importCsv(clinicId, userId, rows);
  }

  @Get('sales')
  @RequireAnyPerm('pharmacy.view', 'cashier.view')
  listSales(
    @CurrentUser() u: U,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('patient_id') patientId?: string,
  ) {
    return this.svc.listSales(need(u).clinicId, { from, to, patientId });
  }

  @Get('sales-report')
  @RequireAnyPerm('pharmacy.view')
  salesReport(
    @CurrentUser() u: U,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('pharmacy_clinic_id') pharmacyClinicId?: string,
    @Query('pharmacy_doctor_id') pharmacyDoctorId?: string,
  ) {
    // Frontend ba'zan bo'sh filtrni "undefined" satr sifatida yuboradi —
    // uuid xatosi bermasligi uchun tozalaymiz.
    const clean = (v?: string) => (v && v !== 'undefined' && v !== 'null' ? v : undefined);
    return this.svc.salesReport(need(u).clinicId, {
      from,
      to,
      pharmacy_clinic_id: clean(pharmacyClinicId),
      pharmacy_doctor_id: clean(pharmacyDoctorId),
    });
  }

  @Get('sales/:id')
  @RequireAnyPerm('pharmacy.view', 'cashier.view')
  getSale(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getSale(need(u).clinicId, id);
  }

  @Post('sales')
  @RequireAnyPerm('pharmacy.dispense', 'cashier.accept_payment')
  @Audit({ action: 'pharmacy.sale_completed', resourceType: 'pharmacy_sales' })
  createSale(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.sell(clinicId, userId, SaleSchema.parse(body));
  }

  @Get('prescriptions/pending')
  @RequireAnyPerm('pharmacy.view', 'prescriptions.view')
  prescriptionsPending(@CurrentUser() u: U) {
    return this.svc.prescriptionsReadyToDispense(need(u).clinicId);
  }

  @Get('prescriptions/:idOrRx')
  @RequireAnyPerm('pharmacy.view', 'prescriptions.view')
  prescriptionById(@CurrentUser() u: U, @Param('idOrRx') idOrRx: string) {
    return this.svc.prescriptionById(need(u).clinicId, idOrRx);
  }

  // ----- Prixod --------------------------------------------------------------
  @Post('receipts')
  @RequirePerm('pharmacy.receive_stock')
  @PharmacyCapability('receive')
  @Audit({ action: 'pharmacy.goods_received', resourceType: 'pharmacy_receipts' })
  createReceipt(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.receipt(clinicId, userId, ReceiptSchema.parse(body));
  }

  @Get('receipts')
  @RequireAnyPerm(...VIEW)
  listReceipts(@CurrentUser() u: U, @Query('limit') limit?: string) {
    return this.svc.listReceipts(need(u).clinicId, limit ? Number(limit) : 100);
  }

  @Get('receipts/:id')
  @RequireAnyPerm(...VIEW)
  getReceipt(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getReceipt(need(u).clinicId, id);
  }

  // Prixodni bekor qilish. Faqat undan hech narsa sotilmagan bo'lsa —
  // aks holda DB funksiyasi rad etadi (sotilgan tovarni "yo'q" qilib
  // bo'lmaydi, u qaytarish orqali rasmiylashtiriladi).
  @Post('receipts/:id/void')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.receipt_voided', resourceType: 'pharmacy_receipts' })
  voidReceipt(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.voidReceipt(clinicId, userId, id, VoidSaleSchema.parse(body));
  }

  @Post('import/match')
  @RequirePerm('pharmacy.receive_stock')
  @PharmacyCapability('receive')
  importMatch(@CurrentUser() u: U, @Body() body: unknown) {
    return this.svc.importMatch(need(u).clinicId, ImportMatchSchema.parse(body));
  }

  @Get('import/profile')
  @RequirePerm('pharmacy.receive_stock')
  @PharmacyCapability('receive')
  getImportProfile(@CurrentUser() u: U, @Query('supplier_id') supplierId?: string) {
    const sid = supplierId && /^[0-9a-f-]{36}$/i.test(supplierId) ? supplierId : undefined;
    return this.svc.getImportProfile(need(u).clinicId, sid);
  }

  @Put('import/profile')
  @RequirePerm('pharmacy.receive_stock')
  @PharmacyCapability('receive')
  saveImportProfile(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.saveImportProfile(clinicId, userId, ImportProfileSchema.parse(body));
  }

  @Post('receipts/duplicate-check')
  @RequirePerm('pharmacy.receive_stock')
  @PharmacyCapability('receive')
  duplicateCheck(@CurrentUser() u: U, @Body() body: unknown) {
    return this.svc.duplicateCheck(need(u).clinicId, DuplicateCheckSchema.parse(body));
  }

  @Get('receipt-drafts')
  @RequirePerm('pharmacy.receive_stock')
  @PharmacyCapability('receive')
  listDrafts(@CurrentUser() u: U) {
    return this.svc.listDrafts(need(u).clinicId);
  }

  @Get('receipt-drafts/:id')
  @RequirePerm('pharmacy.receive_stock')
  @PharmacyCapability('receive')
  getDraft(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getDraft(need(u).clinicId, id);
  }

  @Post('receipt-drafts')
  @RequirePerm('pharmacy.receive_stock')
  @PharmacyCapability('receive')
  createDraft(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.saveDraft(clinicId, userId, null, ReceiptDraftSchema.parse(body));
  }

  @Put('receipt-drafts/:id')
  @RequirePerm('pharmacy.receive_stock')
  @PharmacyCapability('receive')
  saveDraft(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.saveDraft(clinicId, userId, id, ReceiptDraftSchema.parse(body));
  }

  @Delete('receipt-drafts/:id')
  @RequirePerm('pharmacy.receive_stock')
  @PharmacyCapability('receive')
  deleteDraft(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteDraft(need(u).clinicId, id);
  }

  // ----- Mijoz-klinikalar (B2B) ----------------------------------------------
  @Get('clinics')
  @RequireAnyPerm('pharmacy.view', 'pharmacy.dispense')
  listClinics(@CurrentUser() u: U) {
    return this.svc.listClinics(need(u).clinicId);
  }

  @Post('clinics')
  @RequireAnyPerm('pharmacy.dispense')
  @Audit({ action: 'pharmacy.clinic_created', resourceType: 'pharmacy_clinics' })
  createClinic(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.createClinic(clinicId, userId, PharmClinicSchema.parse(body));
  }

  @Patch('clinics/:id')
  @RequireAnyPerm('pharmacy.dispense')
  updateClinic(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.updateClinic(clinicId, id, userId, PharmClinicSchema.partial().parse(body));
  }

  @Delete('clinics/:id')
  @RequireAnyPerm('pharmacy.dispense')
  @PharmacyAdmin()
  archiveClinic(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.archiveClinic(need(u).clinicId, id);
  }

  @Post('clinics/:id/doctors')
  @RequireAnyPerm('pharmacy.dispense')
  addClinicDoctor(
    @CurrentUser() u: U,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { clinicId, userId } = need(u);
    return this.svc.addClinicDoctor(clinicId, id, userId, PharmDoctorSchema.parse(body));
  }

  @Delete('doctors/:id')
  @RequireAnyPerm('pharmacy.dispense')
  @PharmacyAdmin()
  archiveClinicDoctor(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.archiveClinicDoctor(need(u).clinicId, id);
  }

  @Get('clinics/:id/ledger')
  @RequireAnyPerm('pharmacy.view', 'pharmacy.dispense')
  clinicLedger(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.clinicLedger(need(u).clinicId, id);
  }

  @Post('clinics/:id/payment')
  @RequireAnyPerm('pharmacy.dispense', 'cashier.accept_payment')
  @Audit({ action: 'pharmacy.clinic_payment', resourceType: 'pharmacy_clinic_ledger' })
  payClinicDebt(
    @CurrentUser() u: U,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { clinicId, userId } = need(u);
    return this.svc.payClinicDebt(clinicId, userId, id, ClinicPaymentSchema.parse(body));
  }

  @Get('finance')
  @RequireAnyPerm(...VIEW)
  finance(@CurrentUser() u: U) {
    return this.svc.financeSummary(need(u).clinicId);
  }

  @Post('sales/:id/void')
  @RequireAnyPerm('pharmacy.dispense', 'cashier.void')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.sale_voided', resourceType: 'pharmacy_sales' })
  voidSale(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.voidSale(clinicId, userId, id, VoidSaleSchema.parse(body));
  }

  // Savdoni SAVATCHAga arxivlab o'chirish (sabab majburiy). Zaxira qaytariladi.
  // Qaytarish — Sozlamalar > Savatcha.
  @Delete('sales/:id')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.sale_deleted', resourceType: 'pharmacy_sales' })
  deleteSale(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    const { reason } = z.object({ reason: z.string().min(3).max(500) }).parse(body);
    return this.trash.archivePharmacySale(clinicId, userId, id, reason);
  }

  // Savdodan qisman qaytarish — zaxira qaytadi, jami/qarz kamayadi.
  @Post('sales/:id/return')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @PharmacyCapability('return')
  @Audit({ action: 'pharmacy.sale_returned', resourceType: 'pharmacy_sales' })
  returnSale(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    const schema = z.object({
      items: z
        .array(z.object({ sale_item_id: z.string().uuid(), qty: z.number().int().positive() }))
        .min(1),
      reason: z.string().max(500).optional(),
    });
    const { items, reason } = schema.parse(body);
    return this.svc.returnItems(clinicId, userId, id, items, reason ?? '');
  }

  // Zaxirani yarashtirish — medications.stock = Σ partiyalar.
  @Post('reconcile-stock')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.stock_reconciled', resourceType: 'medications' })
  reconcileStock(@CurrentUser() u: U) {
    return this.svc.reconcileStock(need(u).clinicId);
  }

  @Post('supplier-payment')
  @RequireAnyPerm('pharmacy.receive_stock')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.supplier_payment', resourceType: 'pharmacy_receipts' })
  paySupplier(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.paySupplier(clinicId, userId, SupplierPaymentSchema.parse(body));
  }

  // ----- Dorilar (to'liq boshqaruv) ------------------------------------------
  @Get('medications-full')
  @RequireAnyPerm(...VIEW)
  listMedicationsFull(@CurrentUser() u: U, @Query('q') q?: string) {
    return this.svc.listMedicationsFull(need(u).clinicId, q);
  }

  @Post('medications')
  @RequireAnyPerm('medications.create')
  @PharmacyCapability('receive')
  @Audit({ action: 'pharmacy.medication_created', resourceType: 'medications' })
  createMedication(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.createMedication(clinicId, userId, MedicationSchema.parse(body));
  }

  @Post('medications/bulk')
  @RequireAnyPerm('medications.create')
  @PharmacyCapability('receive')
  @Audit({ action: 'pharmacy.medications_bulk_created', resourceType: 'medications' })
  bulkCreateMedications(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.bulkCreateMedications(clinicId, userId, BulkMedicationSchema.parse(body));
  }

  @Patch('medications/:id')
  @RequireAnyPerm('medications.edit')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.medication_updated', resourceType: 'medications' })
  updateMedication(
    @CurrentUser() u: U,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { clinicId, userId } = need(u);
    return this.svc.updateMedication(clinicId, id, userId, MedicationUpdateSchema.parse(body));
  }

  @Post('medications/:id/pack-size')
  @RequireAnyPerm('medications.edit')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.medication_pack_size', resourceType: 'medications' })
  setPackSize(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    const input = PackSizeSchema.parse(body);
    return this.svc.setPackSize(clinicId, userId, id, input.pack_qty, input.convert_stock);
  }

  @Get('medications/:id/price-history')
  @RequireAnyPerm(...VIEW)
  priceHistory(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.priceHistory(need(u).clinicId, id);
  }

  @Get('medications/:id/barcodes')
  @RequireAnyPerm(...VIEW)
  listBarcodes(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.listBarcodes(need(u).clinicId, id);
  }

  @Post('medications/:id/barcodes')
  @RequireAnyPerm('medications.edit', 'pharmacy.receive_stock')
  @PharmacyCapability('receive')
  addBarcode(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    const input = BarcodeSchema.parse(body);
    return this.svc.addBarcode(clinicId, userId, id, input.code, input.kind ?? 'manufacturer');
  }

  @Post('medications/:id/barcodes/internal')
  @RequireAnyPerm('medications.edit', 'pharmacy.receive_stock')
  @PharmacyCapability('receive')
  internalBarcode(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    const { clinicId, userId } = need(u);
    return this.svc.internalBarcode(clinicId, userId, id);
  }

  @Delete('medications/:id/barcodes/:barcodeId')
  @RequireAnyPerm('medications.edit')
  @PharmacyAdmin()
  removeBarcode(
    @CurrentUser() u: U,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('barcodeId', ParseUUIDPipe) barcodeId: string,
  ) {
    return this.svc.removeBarcode(need(u).clinicId, id, barcodeId);
  }

  @Delete('medications/:id')
  @RequireAnyPerm('medications.delete', 'medications.edit')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.medication_archived', resourceType: 'medications' })
  archiveMedication(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.archiveMedication(need(u).clinicId, id);
  }

  @Get('medication-categories')
  @RequireAnyPerm(...VIEW)
  listMedCategories(@CurrentUser() u: U) {
    return this.svc.listMedCategories(need(u).clinicId);
  }

  @Post('medication-categories')
  @RequireAnyPerm('medications.create', 'medications.edit')
  @PharmacyCapability('receive')
  createMedCategory(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.createMedCategory(clinicId, userId, MedCategorySchema.parse(body));
  }

  // ----- Yetkazib beruvchi firmalar + oldi-berdi -----------------------------
  @Get('suppliers')
  @RequireAnyPerm(...VIEW)
  listSuppliers(@CurrentUser() u: U) {
    return this.svc.listSuppliers(need(u).clinicId);
  }

  @Post('suppliers')
  @RequireAnyPerm('pharmacy.receive_stock')
  @PharmacyCapability('receive')
  @Audit({ action: 'pharmacy.supplier_created', resourceType: 'suppliers' })
  createSupplier(@CurrentUser() u: U, @Body() body: unknown) {
    const { clinicId, userId } = need(u);
    return this.svc.createSupplier(clinicId, userId, SupplierSchema.parse(body));
  }

  @Patch('suppliers/:id')
  @RequireAnyPerm('pharmacy.receive_stock')
  @PharmacyCapability('receive')
  @Audit({ action: 'pharmacy.supplier_updated', resourceType: 'suppliers' })
  updateSupplier(
    @CurrentUser() u: U,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { clinicId, userId } = need(u);
    return this.svc.updateSupplier(clinicId, id, userId, SupplierUpdateSchema.parse(body));
  }

  @Delete('suppliers/:id')
  @RequireAnyPerm('pharmacy.receive_stock')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.supplier_archived', resourceType: 'suppliers' })
  archiveSupplier(@CurrentUser() u: U, @Param('id', ParseUUIDPipe) id: string) {
    const { clinicId, userId } = need(u);
    return this.svc.archiveSupplier(clinicId, id, userId);
  }

  @Get('suppliers/:id/ledger')
  @RequireAnyPerm(...VIEW)
  supplierLedger(
    @CurrentUser() u: U,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
  ) {
    return this.svc.supplierLedger(need(u).clinicId, id, { from, to, q });
  }

  @Post('suppliers/:id/ledger')
  @RequireAnyPerm('pharmacy.receive_stock')
  @PharmacyAdmin()
  @Audit({ action: 'pharmacy.supplier_entry', resourceType: 'pharmacy_supplier_ledger' })
  addSupplierEntry(
    @CurrentUser() u: U,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { clinicId, userId } = need(u);
    return this.svc.addSupplierEntry(clinicId, userId, id, SupplierEntrySchema.parse(body));
  }
}
