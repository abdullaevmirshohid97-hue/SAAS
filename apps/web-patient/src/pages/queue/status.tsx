import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { QueueTicker } from '@/components/queue-ticker';

export function QueueStatusPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  if (!id) {
    return (
      <div className="text-muted-foreground py-24 text-center text-sm">Navbat ID topilmadi</div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <button
        onClick={() => navigate(-1)}
        className="text-muted-foreground hover:text-foreground mb-6 flex items-center gap-2 text-sm transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Orqaga
      </button>

      <h1 className="mb-4 text-xl font-bold">Navbat holati</h1>
      <QueueTicker bookingId={id} />

      <p className="text-muted-foreground mt-4 text-center text-xs">
        Sahifani ochiq saqlasangiz, navbat holati avtomatik yangilanadi
      </p>
    </div>
  );
}
