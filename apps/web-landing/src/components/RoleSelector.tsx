import { motion } from 'framer-motion';
import { Heart, Building2, Stethoscope, ArrowRight } from 'lucide-react';

type Role = {
  key: string;
  icon: typeof Heart;
  title: string;
  subtitle: string;
  bullets: string[];
  href: string;
  cta: string;
  gradient: string;
  iconBg: string;
};

const ROLES: Role[] = [
  {
    key: 'patient',
    icon: Heart,
    title: 'Bemorman',
    subtitle: "Klinika top, navbat ol, hamshira chaqir",
    bullets: ['Yaqin klinikalar', 'Online navbat', 'Uyga hamshira'],
    href: '/patients',
    cta: 'Batafsil',
    gradient: 'from-pink-500/15 via-rose-500/10 to-transparent',
    iconBg: 'bg-pink-500/15 text-pink-600 dark:text-pink-400',
  },
  {
    key: 'clinic',
    icon: Building2,
    title: 'Klinikaman',
    subtitle: "Klinikangizni bir joydan boshqaring",
    bullets: ['CRM + bemor bazasi', 'Navbat va kassa', 'Analitika va hisobot'],
    href: '/clinics',
    cta: 'Batafsil',
    gradient: 'from-blue-500/15 via-indigo-500/10 to-transparent',
    iconBg: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  },
  {
    key: 'nurse',
    icon: Stethoscope,
    title: 'Hamshiraman',
    subtitle: "Vazifalar oling, daromad qiling",
    bullets: ['Moslashuvchan jadval', 'Klinika bilan ishlash', "To'g'ridan to'g'ri to'lov"],
    href: '/nurses',
    cta: 'Batafsil',
    gradient: 'from-emerald-500/15 via-teal-500/10 to-transparent',
    iconBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

export function RoleSelector() {
  return (
    <motion.div
      className="mx-auto mt-12 grid w-full max-w-5xl gap-4 sm:gap-5 md:grid-cols-3"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      {ROLES.map((role) => {
        const Icon = role.icon;
        return (
          <motion.a
            key={role.key}
            href={role.href}
            variants={cardVariants}
            whileHover={{ y: -4, transition: { duration: 0.2 } }}
            whileTap={{ scale: 0.98 }}
            className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card p-6 text-left shadow-sm transition-shadow hover:shadow-xl"
          >
            <div
              className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${role.gradient} opacity-0 transition-opacity duration-300 group-hover:opacity-100`}
              aria-hidden="true"
            />
            <div className="relative flex items-start justify-between">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${role.iconBg}`}>
                <Icon className="h-6 w-6" strokeWidth={2.2} />
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform duration-300 group-hover:-rotate-45 group-hover:text-foreground" />
            </div>

            <h3 className="relative mt-5 text-2xl font-bold tracking-tight">{role.title}</h3>
            <p className="relative mt-1 text-sm text-muted-foreground">{role.subtitle}</p>

            <ul className="relative mt-5 space-y-2 text-sm">
              {role.bullets.map((b) => (
                <li key={b} className="flex items-center gap-2 text-muted-foreground">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>

            <div className="relative mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
              {role.cta}
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </motion.a>
        );
      })}
    </motion.div>
  );
}
