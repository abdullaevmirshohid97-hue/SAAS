import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // DIQQAT: ilgari bu yerda '**/*.module.ts' ham bor edi. Bu API'dagi
      // biznes-logikaning deyarli hammasini o'lchovdan chiqarib yuborardi —
      // 63/91 fayl aynan *.module.ts (bitta modul = bitta fayl konvensiyasi),
      // shuning uchun 80% chegara bo'sh to'plamda o'lchanib doim o'tardi.
      exclude: ['**/main.ts', '**/dist/**'],
      // Chegaralar hozirgi HAQIQIY holatga qo'yilgan. Ular past — bu ataylab:
      // yolg'on 80% dan halol past raqam yaxshiroq. Pul yo'liga (checkout,
      // kassa, maosh) test qo'shilgani sari bosqichma-bosqich ko'tariladi.
      //
      // ESLATMA: coverage'ni haqiqatda ishga tushirish uchun `@vitest/coverage-v8`
      // devDependency sifatida o'rnatilishi kerak — hozir o'rnatilmagan, shu
      // sababli bu blok hech qachon bajarilmagan. CI ham `vitest run` ni
      // --coverage'siz chaqiradi.
      thresholds: { lines: 1, functions: 1, statements: 1, branches: 1 },
    },
  },
});
