import { Card, CardHeader, CardTitle, CardContent, Input, Button } from '@clary/ui-web';

export function SettingsClinicPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Klinika ma’lumotlari</h2>
      <Card>
        <CardHeader><CardTitle>Umumiy</CardTitle></CardHeader>
        <CardContent className="space-y-3 max-w-md">
          <label className="text-sm font-medium">Klinika nomi</label>
          <Input />
          <label className="text-sm font-medium">Manzil</label>
          <Input />
          <label className="text-sm font-medium">Telefon</label>
          <Input />
          <Button className="mt-2">Saqlash</Button>
        </CardContent>
      </Card>
    </div>
  );
}
