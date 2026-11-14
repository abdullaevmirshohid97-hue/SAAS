import type { CastAdsState } from '@clary/api-client';

import { api } from './api';

// =============================================================================
// TV reklama videosini yuklash: API limitni tekshirib imzolangan URL beradi →
// fayl brauzerdan TO'G'RIDAN-TO'G'RI saqlashga ketadi (katta video API serveridan
// o'tmaydi, foiz ko'rinadi) → API haqiqiy hajmni qayta tekshirib TV'ga chiqaradi.
// =============================================================================

const BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

export function adVideoType(file: File): string | null {
  const t = (file.type || '').toLowerCase();
  if (t === 'video/mp4' || t === 'video/webm' || t === 'video/quicktime') return t;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXT[ext] ?? null;
}

function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', contentType);
    xhr.setRequestHeader('cache-control', 'max-age=604800');
    xhr.setRequestHeader('x-upsert', 'false');
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (anon) xhr.setRequestHeader('apikey', anon);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `Yuklash xatosi (${xhr.status})`;
      try {
        const j = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        msg = j.message || j.error || msg;
      } catch {
        /* matn emas */
      }
      if (xhr.status === 413 || /too large|exceeded the maximum/i.test(msg)) {
        msg = 'Video saqlash xizmati chegarasidan katta — kichikroq (siqilgan) video yuklang';
      }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('Internet uzildi — qayta urinib ko‘ring'));
    xhr.send(file);
  });
}

export async function uploadAdVideo(
  file: File,
  onProgress: (pct: number) => void,
): Promise<CastAdsState> {
  const contentType = adVideoType(file);
  if (!contentType) throw new Error('Faqat MP4 yoki WebM video yuklanadi');
  const { id, signed_url } = await api.cast.adsUploadUrl({
    file_name: file.name,
    size_bytes: file.size,
    content_type: contentType,
  });
  try {
    await putWithProgress(signed_url, file, contentType, onProgress);
  } catch (e) {
    // Band qilingan joyni bo'shatamiz (aks holda limit 6 soatgacha band turadi)
    await api.cast.adsDelete(id).catch(() => undefined);
    throw e;
  }
  return api.cast.adsComplete(id);
}

export function fmtBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

export function fmtMb(mb: number): string {
  return mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}
