import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CastVoiceRecorder, PageHeader, blobToBase64 } from '@clary/ui-web';
import { Loader2 } from 'lucide-react';

import { api } from '@/lib/api';

// =============================================================================
// Clary Cast — platformaning STANDART navbat ovozi. Barcha klinikalarning TV'si
// shu yozuvlar bilan chaqiradi ("To'rt raqamli bemor, sakkizinchi xonaga
// marhamat"); klinika o'zi yozgan iboralar bu standartdan ustun turadi.
// =============================================================================

export function CastVoicePage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-cast-voice'],
    queryFn: () => api.cast.adminVoice(),
  });
  const setClips = (clips: Record<string, string>) =>
    qc.setQueryData(['admin-cast-voice'], { clips });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Navbat ovozi (TV)"
        description="Klinikalarning kutish zalidagi TV bemorni shu ovoz bilan chaqiradi. Bir marta yozib oling — barcha klinikalarga darhol tarqaladi. Diktor ovozi bo‘lsa, har bir iborani alohida fayl qilib yuklang."
      />
      <Card>
        <CardContent className="p-4">
          {isLoading || !data ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </div>
          ) : (
            <CastVoiceRecorder
              clips={data.clips}
              onSave={async (key, blob) => {
                const r = await api.cast.adminUploadVoice(key, await blobToBase64(blob), blob.type);
                setClips(r.clips);
              }}
              onDelete={async (key) => {
                const r = await api.cast.adminRemoveVoice(key);
                setClips(r.clips);
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
