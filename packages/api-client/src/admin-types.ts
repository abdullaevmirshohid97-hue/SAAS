// Super-admin bosh sahifasi: obunalar holati, MRR va e'tibor talab qiladigan klinikalar.

export type AdminOverviewClinic = {
  id: string;
  name: string;
  city: string | null;
  plan: string | null;
  plan_name: string | null;
  status: string | null;
  /** Ro'yxatga qarab: sinov tugashi / grace / obuna tugagan / yaratilgan sana. */
  date: string | null;
};

export type AdminOverview = {
  totals: {
    tenants: number;
    active_paying: number;
    trialing: number;
    past_due: number;
    blocked: number;
    suspended: number;
    demo_live: number;
    mrr_uzs: number;
    new_leads: number;
    invoices_paid_month_uzs: number;
    invoices_overdue_uzs: number;
    invoices_overdue_count: number;
    clinics_turnover_30d_uzs: number;
  };
  by_status: Record<string, number>;
  attention: {
    trial_expiring: AdminOverviewClinic[];
    past_due: AdminOverviewClinic[];
    blocked: AdminOverviewClinic[];
  };
  recent_clinics: AdminOverviewClinic[];
  daily_revenue: Array<{ day: string; amount_uzs: number }>;
};
