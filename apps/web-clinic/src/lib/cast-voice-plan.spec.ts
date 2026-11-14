import { describe, expect, it } from 'vitest';
import { castAnnouncementPlan } from '@clary/schemas';

// Yozib olingan bo'laklar: 4 ibora + n1..n100 (tartib sonlar o* hali YO'Q).
const recorded = new Set([
  'p_patient',
  'p_room',
  'p_welcome',
  'p_next',
  ...Array.from({ length: 100 }, (_, i) => `n${i + 1}`),
]);
const has = (k: string) => recorded.has(k);

describe('castAnnouncementPlan — yozilgan ovoz bilan chaqiruv', () => {
  it('xonasiz: "4 raqamli bemor, qabulga marhamat"', () => {
    expect(castAnnouncementPlan({ seq: 4 }, has).clips).toEqual(['n4', 'p_patient', 'p_welcome']);
  });

  it('xona tartib soni yozilmagan — jim qolmaydi, qabulga marhamat deydi', () => {
    expect(castAnnouncementPlan({ seq: 45, room: '8' }, has).clips).toEqual([
      'n45',
      'p_patient',
      'p_welcome',
    ]);
  });

  it('"UZI" kabi xona nomi — bemor raqami baribir aytiladi', () => {
    expect(castAnnouncementPlan({ seq: 12, room: 'UZI' }, has).clips).toEqual([
      'n12',
      'p_patient',
      'p_welcome',
    ]);
  });

  it('tartib son yozilgan bo‘lsa — xona bilan aytiladi', () => {
    const withO8 = (k: string) => has(k) || k === 'o8';
    expect(castAnnouncementPlan({ seq: 4, room: '8-xona' }, withO8).clips).toEqual([
      'n4',
      'p_patient',
      'o8',
      'p_room',
    ]);
  });
});
