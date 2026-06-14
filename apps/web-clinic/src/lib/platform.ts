// Muhitni aniqlash — Tauri (desktop) ichidamizmi yoki oddiy brauzerdami.
//
// MUHIM: barcha native (desktop) xususiyat shu funksiya orqasida turishi kerak.
// Brauzerda `isTauri()` doim `false` qaytaradi → mavjud web yo'li o'zgarmaydi
// (regressiya yo'q). Tauri 2 webview'ida `__TAURI_INTERNALS__` global mavjud bo'ladi.
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
