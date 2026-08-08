# Clary — brend assetlari

> **Diqqat:** bu papkadagi SVG'lar **qo'lda tahrirlanmaydi**. Ular
> `scripts/brand/gen-brand-assets.mjs` tomonidan yaratiladi. O'zgartirish
> kerak bo'lsa — generatorni tahrirlang va qayta ishga tushiring:
>
> ```bash
> node scripts/brand/gen-brand-assets.mjs
> ```

## Brend tizimi (v2, 2026-08-08)

Clary brendi — **tipografik**. Rasm-logotip yo'q; brend nomi shriftda yoziladi.
Shu sabab u har o'lchamda aniq, temaga moslashadi va koddan qayta tiklanadi.

| Daraja           | Nima                          | Qayerda                                    |
| ---------------- | ----------------------------- | ------------------------------------------ |
| Wordmark `CLARY` | Keng harf oralig'ida, urg'u chizig'i bilan | UI sarlavha, OG rasm, splash |
| Monogramma `C`   | To'q yumaloq kvadratda oq harf | favicon, app icon, collapsed sidebar       |

**Shrift zinapoyasi:** `Bahnschrift → DIN Next → Segoe UI Variable Display → Segoe UI → system-ui`
(DIN oilasidagi texnik grotesk; tizimda yo'q bo'lsa eng yaqin sans'ga tushadi).

**Ranglar:**

| Rol         | Qiymat    | Izoh                              |
| ----------- | --------- | --------------------------------- |
| Ink (fon)   | `#0A0A0A` | ikon plitkasi, splash             |
| Ink-2       | `#141821` | OG gradientining sovuq uchi       |
| Paper (harf)| `#FFFFFF` | wordmark va monogramma            |
| Accent      | `#2563EB` | urg'u chizig'i (LED), OG chizig'i |

**Harf oralig'i (tracking):** `0.22em` — hi-tech ohangning asosiy tashuvchisi.

## Fayllar

| Fayl            | Nima                                                   |
| --------------- | ------------------------------------------------------ |
| `logo.svg`      | Wordmark, `currentColor` (och/to'q fonda ishlaydi)     |
| `wordmark.svg`  | `logo.svg` bilan bir xil (tashqi foydalanuvchilar uchun alias) |
| `icon.svg`      | 1024 kvadrat monogramma                                |
| `favicon.svg`   | 32 kvadrat monogramma                                  |
| `tokens.json`   | ⚠️ **ESKIRGAN, ISHLATILMAYDI** — pastga qarang         |

### tokens.json haqida

Bu fayl eski "CLARY CARE" konsepsiyasidan qolgan (feruza `#0EA5E9` + yashil
`#10B981`, Manrope shrifti). **Hech qaysi ilova undan o'qimaydi** — ranglar
Tailwind konfiguratsiyalarida (`packages/config-tailwind`) va CSS
o'zgaruvchilarida belgilangan. Adashtirmasligi uchun shu yerda ochiq
yozilgan; kelajakda dizayn-token tizimi qurilsa, u haqiqiy qiymatlardan
qayta yozilishi kerak.

## Foydalanish qoidalari

- Minimal balandlik: wordmark 16px, monogramma 16px
- Bo'sh joy: harf balandligining 1× atrofida
- ❌ Cho'zish, aylantirish, soya qo'shish
- ✅ Bitta rangli kontekstda `logo.svg` (`currentColor`) ishlatiladi

## Ilovada

React ilovalarda rasm emas, komponent ishlatiladi:

```tsx
import { ClaryLogo } from '@clary/ui-web';

<ClaryLogo variant="full" size="md" />   // CLARY wordmark
<ClaryLogo variant="mark" size="md" />   // C monogramma
```

Landing (Astro) uchun: `src/components/BrandLogo.astro`.
