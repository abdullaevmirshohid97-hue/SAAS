# Laboratoriya AI yordamchisi — arxitektura (kelajak)

> Holat: **arxitektura hujjati**. Kod yo'q. FAZA 4 doirasida — kelajakda AI
> qatlamini qo'shish uchun qaysi ma'lumot va interfeys tayyorligini belgilaydi.

## Maqsad

Laboratoriya natijalari ustida AI yordamchi:

1. **Anomaliya aniqlash** — natija bemorning o'z tarixiga yoki populyatsiya
   normasiga nisbatan kutilmagan o'zgarish.
2. **Xavfli kombinatsiyalar** — bir nechta natija birgalikda klinik xavf
   bildiradi (masalan past kaliy + yuqori kreatinin).
3. **Klinik patternlar** — natijalar to'plami ma'lum holatga ishora qiladi.
4. **Tashxis takliflari** — ICD-10 yo'nalishida ehtimoliy tashxislar (shifokor
   qaroriga yordam, o'rnini bosmaydi).

## Tayyor ma'lumot bazasi (allaqachon mavjud)

AI qatlami yangi jadval talab qilmaydi — quyidagilar yetarli:

| Manba | Nima beradi |
|-------|-------------|
| `lab_results.numeric_value` | Raqamli qiymat — model kirishi (FAZA 2) |
| `lab_results.loinc_code` | LOINC standart — testlararo taqqoslash (FAZA 2) |
| `lab_results.flag` | normal/low/high/critical — belgilangan label (FAZA 2) |
| `lab_results.validation_status` | Faqat `validated` natija AI ga beriladi (FAZA 3) |
| `LabService.patientTrend()` | Bemor tarixi vaqt qatori sifatida (FAZA 3) |
| `icd10_lab_recommendations` | ICD-10 ↔ LOINC bog'lanishi (FAZA 1) |
| `loinc_tests` | Test metama'lumotlari, kategoriya (FAZA 1) |

## Tavsiya etilgan interfeys (kelajak)

Sof funksiya sifatida, `lab/ai/` papkasida — DB ga tegmaydi, test qilinadi:

```ts
interface LabAiInsight {
  kind: 'anomaly' | 'dangerous_combo' | 'pattern' | 'dx_suggestion';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  relatedLoinc: string[];
  confidence: number; // 0..1
}

interface LabAiAnalyzer {
  analyze(input: {
    current: LabResultForFhir[];        // joriy buyurtma natijalari
    history: Array<{ loinc: string; series: number[] }>; // patientTrend
  }): LabAiInsight[];
}
```

## Bosqichma-bosqich joriy qilish (taklif)

1. **Qoida asosidagi** (model emas) — xavfli kombinatsiyalar uchun aniq
   tibbiy qoidalar to'plami. Tez, tushunarli, validatsiya oson.
2. **Statistik anomaliya** — bemor tarixida z-score / trend burilishi.
3. **ML model** — yetarli anonimlashtirilgan ma'lumot to'plangach.

Har bosqichda chiqish `LabAiInsight[]` — UI o'zgarmaydi.

## Xavfsizlik / maxfiylik chegaralari

- AI faqat **tenant ichidagi** ma'lumot bilan ishlaydi — RLS o'zgarmaydi.
- Tashqi LLM API ga bemor ma'lumoti yuborilmaydi (yoki yuborilsa —
  anonimlashtirilgan, alohida rozilik bilan; `docs/compliance/` ga muvofiq).
- AI taklifi **hech qachon** validatsiya o'rnini bosmaydi — `validation_status`
  oqimi o'zgarmaydi, AI faqat maslahat qatlami.
