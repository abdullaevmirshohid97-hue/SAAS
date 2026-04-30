import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { QueueTicker } from '@/components/queue-ticker';

export function QueueStatusPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  if (!id) {
    return (
      <div className="text-center py-24 text-muted-foreground text-sm">
        Navbat ID topilmadi
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Orqaga
      </button>

      <h1 className="text-xl font-bold mb-4">Navbat holati</h1>
      <QueueTicker bookingId={id} />

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Sahifani ochiq saqlasangiz, navbat holati avtomatik yangilanadi
      </p>
    </div>
  );
}
