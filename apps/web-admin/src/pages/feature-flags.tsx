import { Card, CardHeader, CardTitle, CardContent } from '@clary/ui-web';

export function FeatureFlagsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Feature flags</h1>
      <Card>
        <CardHeader><CardTitle>Per-tenant toggles</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select a tenant to enable/disable features (e.g. DICOM viewer, public API, custom domain). API: POST /api/v1/admin/feature-flags</p>
        </CardContent>
      </Card>
    </div>
  );
}
