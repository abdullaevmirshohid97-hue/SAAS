# Davlat dori katalogi (MXIK) va davlat reestri

Barcha dorixonalar uchun umumiy ma'lumotnoma: dorilar, BAD va tibbiy buyumlar.
Prixodda nomning 1–2 harfi yozilganda nomi, ishlab chiqaruvchi, MXIK, qadoqdagi
dona soni, QQS imtiyozi va qadoq kodi o'zi to'ladi; skanerlangan shtrix-kod
dorini o'zi topadi.

## Manbalar

| Manba                                 | Nima beradi                                                                                                                       | Qanday olinadi                                                                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MXIK katalogi — `tasnif.soliq.uz`     | savdo nomi, ishlab chiqaruvchi, shakli, dozasi, `№20(2x10)`, MNN, ATX, shtrix-kod (~50%), QQS imtiyozi (243-modda), qadoq kodlari | API o'zi yig'adi: ochiq `/attribute/web-katalog` (sinf bo'yicha, 1000 tadan), har kuni 04:10 da tekshiriladi, oxirgi muvaffaqiyatli yig'ish 6.5 kundan eski bo'lsa yangilanadi |
| Davlat reestri — `uzpharm-control.uz` | ro'yxat raqami, amalda / muddati o'tgan, mamlakat, retsept belgisi                                                                | super admin saytdan Excel'ni (captcha) yuklab, admin paneldagi "Dori katalogi (MXIK)" sahifasiga tashlaydi                                                                     |
| Dorixonalar                           | MXIK'da yo'q shtrix-kodlar                                                                                                        | MXIK'li doriga kod biriktirilganda trigger katalogga yozadi (`source='clinic'`, `confirmations`)                                                                               |
| MXIK jonli so'rov                     | katalogda yo'q shtrix-kod                                                                                                         | prixod skaneri: `/elasticsearch/search?search=<EAN>`; topilmasa 6 soat qayta so'ralmaydi                                                                                       |

Yig'iladigan sinflar: `packages/utils/src/drug-reference.ts` → `MXIK_HARVEST_TARGETS`
(03004 dorilar, 03001–03003, 02106999028 BAD, 09018–09025 tibbiy buyumlar,
03005/03006 bint/paxta va boshqalar, 03822 testlar). Lokal sinovda to'liq yig'ish:
48 711 yozuv, 24 848 shtrix-kod, ~4.5 daqiqa.

## Qismlar

- Baza: `supabase/migrations/20261006000001_drug_reference.sql` (katalog, qidiruv,
  `pharmacy_adopt_reference`, kod o'rganish triggerlari) va
  `20261006000002_drug_registry.sql` (reestr importi va moslash).
- API: `apps/api/src/modules/drug-reference/` — `/pharmacy/reference/{search,lookup,packages,adopt}`,
  `/admin/drug-reference/{stats,search,sync,registry/*}`; `PharmacyService.lookup(…, ref=1)`
  va Excel `importMatch` katalogdan ham qidiradi.
- Parser (API va testlar uchun bitta): `packages/utils/src/drug-reference.ts`.
- Veb: prixod (`receipt.tsx`, `receipt-dialogs.tsx`), yangi dori formasi
  (`medications.tsx`), super admin sahifasi (`apps/web-admin/src/pages/drug-reference.tsx`).

## Deploy

```bash
DATABASE_URL="postgresql://postgres:PAROL@db.aoubdvlkcatbeifuysau.supabase.co:5432/postgres" \
  bash scripts/deploy-drug-reference.sh
```

Skript migratsiyalarni qo'llaydi, `scripts/verify-drug-reference.sql` bilan
tekshiradi (tranzaksiya oxirida bekor qilinadi), serverdan MXIK API ochiqligini
tekshiradi va api + web + admin'ni deploy qiladi. Keyin admin panelda
**"MXIK'dan yangilash"** bosiladi (birinchi to'ldirish).

Rejali sinxronni o'chirish: API env `DRUG_REFERENCE_SYNC=off`.

## Muammolar

| Belgi                                | Sabab / yechim                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hamma sinf "xato": `fetch failed`    | Server (VPS) tasnif.soliq.uz'ga ulana olmayapti — davlat sayti xorijiy server IP'sini bloklagan bo'lishi mumkin. Admin sahifada **"Brauzer orqali yuklash"**: katalog super admin kompyuteri orqali yuklanadi (MXIK API CORS ochiq). Prixod skaneri va qadoq kodlari ham shu holatda dorixona brauzeridan so'raladi. Tekshirish: serverda `curl -sv https://tasnif.soliq.uz/api/cls-api/attribute/web-katalog?classCode=09018&pageNo=0&pageSize=1 -o /dev/null`. |
| Ayrim sinf "xato"                    | Vaqtinchalik javob kelmadi. Qayta urining; holat `partial` bo'lsa faqat to'liq yuklangan sinflar yangilangan.                                                                                                                                                                                                                                                                                                                                                    |
| Katalogda dori yo'qolgan             | Yozuv 20 kun MXIK'da ko'rinmasa nofaol bo'ladi (`is_active=false`). Bir martalik uzilish yozuvni o'chirmaydi.                                                                                                                                                                                                                                                                                                                                                    |
| Reestr moslanmagan dori              | Moslash: reestrdagi savdo nomi katalogdagi nom bilan boshlanadi + ishlab chiqaruvchi o'xshashligi. Nom boshqacha yozilgan bo'lsa moslanmaydi (holat `null` — ogohlantirish chiqmaydi).                                                                                                                                                                                                                                                                           |
| Qadoq kodi bo'sh                     | Dori qo'shilganda MXIK `/integration-mxik/get/history` javob bermagan. Keyingi qo'shishda qayta so'raladi; kerak bo'lsa dorining fiskal maydonida qo'lda kiritiladi.                                                                                                                                                                                                                                                                                             |
| `column … not found in schema cache` | Migratsiya qo'llanmagan yoki `NOTIFY pgrst, 'reload schema'` yuborilmagan.                                                                                                                                                                                                                                                                                                                                                                                       |
