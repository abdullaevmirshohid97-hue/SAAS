---
name: Auth strategy — Google OAuth, not My ID
description: Identity verification uses Google Sign-In across web/mobile; My ID integration is cancelled
type: project
originSessionId: 87e1101d-6f2b-48c6-856c-8caf7b80e816
---
**Decision (2026-05-03):** My ID integratsiyasi rejadan olib tashlandi. Identifikatsiya uchun Google OAuth ishlatiladi.

- **Web:** Supabase Auth Google provider (klinika xodimlari, hamshira ariza berishda)
- **Mobile (KMP):** Google Sign-In SDK (Android: Credential Manager, iOS: GoogleSignIn-iOS)
- **Bemor uchun:** SMS OTP (Eskiz.uz) asosiy oqim qoladi; Google Sign-In ixtiyoriy
- **Hamshira uchun:** Google Sign-In majburiy (oldindan rejalashtirilgani bo'yicha)
- **PINFL/pasport tasdig'i:** kerak emas — Google email + manual klinika tasdig'i yetarli

**Why:** LLC ro'yxatdan o'tishni kutish kerak emas, integratsiya tezroq, foydalanuvchi tajribasi yaxshi.
**How to apply:** Bosqich 5 endi 2 sessiya emas, 1 sessiya. Mobile KMP setup ichida (Bosqich 4) Google Sign-In darrov qo'shiladi. portal_users jadvali pinfl/passport ustunlarisiz qoladi.
