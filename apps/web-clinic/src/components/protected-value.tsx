// =============================================================================
// Yashirilgan maydon ko'rsatkichi
// =============================================================================
// Server maydon darajasidagi xavfsizlikda qiymatni `null` qiladi va yoniga
// `<field>_hidden: true` qo'yadi (FieldSecurityInterceptor).
//
// Nega shunday: "ma'lumot yo'q" bilan "ko'rishga ruxsat yo'q" — bu ikki
// BOSHQA holat. Ikkalasini ham "—" deb ko'rsatsak, xodim ma'lumot
// yo'q deb o'ylaydi va qidirishda vaqt yo'qotadi. `•••` esa aniq aytadi:
// maydon bor, lekin sizga ko'rinmaydi.

export function ProtectedValue({
  value,
  hidden,
  empty = '—',
  className,
}: {
  value: React.ReactNode;
  /** Serverdagi `<field>_hidden` bayrog'i. */
  hidden?: boolean;
  /** Qiymat bo'sh bo'lgandagi belgi. */
  empty?: string;
  className?: string;
}) {
  if (hidden) {
    return (
      <span
        className={`text-muted-foreground cursor-help font-mono ${className ?? ''}`}
        title="Bu maydonni ko'rishga ruxsatingiz yo'q"
      >
        •••
      </span>
    );
  }
  if (value === null || value === undefined || value === '') {
    return <span className={`text-muted-foreground ${className ?? ''}`}>{empty}</span>;
  }
  return <span className={className}>{value}</span>;
}
