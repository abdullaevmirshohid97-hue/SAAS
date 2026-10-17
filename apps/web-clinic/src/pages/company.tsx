import { useMemo } from 'react';
import { Building2 } from 'lucide-react';

import {
  Card,
  CardContent,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@clary/ui-web';

import { useAuth } from '@/providers/auth-provider';
import { LiveTab } from '@/components/network/live-tab';
import { CompareTab } from '@/components/network/compare-tab';
import { BranchesTab, StaffTab } from '@/components/network/branches-tab';
import { CatalogTab } from '@/components/network/catalog-tab';
import { TransfersTab } from '@/components/network/transfers-tab';
import { ReferralsTab } from '@/components/network/referrals-tab';
import { PatientsTab } from '@/components/network/patients-tab';
import { MembersTab } from '@/components/network/members-tab';
import { useNetworkMy } from '@/components/network/shared';

// =============================================================================
// Tarmoq markazi (/company) — bir joydan 10 tagacha filial:
//   rahbariyat: jonli holat, taqqoslash, filiallar, xodimlar, katalog,
//   transferlar, yo'llanmalar, dublikatlar, a'zolar;
//   filial xodimi (tarmoqda): transferlar va boshqa filialga yo'llanma.
// =============================================================================
export function CompanyPage() {
  const { role } = useAuth();
  const { data: my, isLoading } = useNetworkMy();

  const colors = useMemo(
    () => Object.fromEntries((my?.branches ?? []).map((b) => [b.id, b.branch_color])),
    [my],
  );

  if (isLoading || !my) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const viewer = my.viewer;
  const branches = my.branches;
  const inNetwork = branches.length > 1;
  const canManage = !!viewer?.can_manage;
  const isLeader = role === 'clinic_owner' || role === 'clinic_admin';
  const visibleBranches = viewer
    ? branches.filter((b) => viewer.branch_ids.includes(b.id))
    : branches;

  const tabs: Array<{ id: string; label: string; show: boolean }> = [
    { id: 'live', label: 'Jonli holat', show: !!viewer },
    { id: 'compare', label: 'Taqqoslash', show: !!viewer },
    { id: 'branches', label: 'Filiallar', show: !!viewer && inNetwork },
    { id: 'staff', label: 'Xodimlar', show: !!viewer && inNetwork },
    { id: 'catalog', label: 'Katalog', show: canManage && inNetwork },
    { id: 'transfers', label: 'Transferlar', show: inNetwork },
    { id: 'referrals', label: "Yo'llanmalar", show: inNetwork },
    { id: 'patients', label: 'Dublikatlar', show: canManage || isLeader },
    { id: 'members', label: 'Rahbariyat', show: canManage },
  ];
  const shown = tabs.filter((t) => t.show);

  const title = inNetwork
    ? `Tarmoq markazi — ${my.company?.name ?? ''}`
    : (my.company?.name ?? 'Kompaniya');
  const subtitle = inNetwork
    ? `${branches.length} filial (limit ${my.company?.max_branches ?? branches.length}) · ${
        viewer
          ? viewer.member_role === 'company_owner'
            ? 'tarmoq egasi'
            : viewer.member_role === 'company_admin'
              ? 'tarmoq admini'
              : viewer.member_role === 'branch_user'
                ? 'hududiy menejer'
                : 'rahbar'
          : 'filial xodimi'
      }`
    : 'Bitta filial';

  return (
    <div className="space-y-5">
      <PageHeader title={title} description={subtitle} />

      {!inNetwork && (
        <Card>
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <Building2 className="text-primary mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-medium">Filiallar tarmog'i — bir joydan 10 tagacha filial</div>
              <p className="text-muted-foreground">
                Ikkinchi filial ochsangiz, shu sahifada barcha filiallarning bugungi tushumi,
                navbati, kassasi, reytingi, markaziy narxlar, filiallararo dori va pul o'tkazmalari
                bitta ekranda bo'ladi. Ulash uchun Clary qo'llab-quvvatlash xizmatiga murojaat
                qiling.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {shown.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground p-4 text-sm">
            Tarmoq markazi faqat klinika rahbariyati uchun.
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue={shown[0]!.id}>
          <div className="overflow-x-auto">
            <TabsList>
              {shown.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {viewer && (
            <>
              <TabsContent value="live" className="mt-4">
                <LiveTab activeClinicId={my.active_clinic_id} />
              </TabsContent>
              <TabsContent value="compare" className="mt-4">
                <CompareTab colors={colors} />
              </TabsContent>
              <TabsContent value="branches" className="mt-4">
                <BranchesTab
                  branches={visibleBranches}
                  activeClinicId={my.active_clinic_id}
                  canManage={canManage}
                />
              </TabsContent>
              <TabsContent value="staff" className="mt-4">
                <StaffTab branches={visibleBranches} canManage={canManage} />
              </TabsContent>
            </>
          )}
          {canManage && (
            <TabsContent value="catalog" className="mt-4">
              <CatalogTab branches={visibleBranches} />
            </TabsContent>
          )}
          <TabsContent value="transfers" className="mt-4">
            <TransfersTab
              branches={branches}
              activeClinicId={my.active_clinic_id}
              canManage={canManage}
            />
          </TabsContent>
          <TabsContent value="referrals" className="mt-4">
            <ReferralsTab branches={branches} activeClinicId={my.active_clinic_id} />
          </TabsContent>
          <TabsContent value="patients" className="mt-4">
            <PatientsTab />
          </TabsContent>
          {canManage && (
            <TabsContent value="members" className="mt-4">
              <MembersTab
                branches={visibleBranches}
                company={my.company}
                isOwner={!!viewer?.is_owner && viewer.member_role === 'company_owner'}
              />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
