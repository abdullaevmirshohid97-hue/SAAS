# Mobile build & publish workflow

## Preview APK (Android, internal distribution)

```bash
# 1. From repo root
cd apps/mobile

# 2. Login to Expo (one-time)
npx eas login

# 3. Build APK
pnpm build:eas:preview
# → produces an APK URL on https://expo.dev/

# 4. Publish that URL to landing /download + app_versions table
SUPABASE_URL=...prod... \
SUPABASE_SERVICE_ROLE_KEY=...service... \
pnpm publish:preview \
  --version=0.1.0-preview-$(date +%Y%m%d) \
  --android-url=https://expo.dev/artifacts/eas/<id>.apk \
  --notes="Preview build, dental modul + emergency call"
```

After this:
- `https://www.clary.uz/download` shows the new APK URL.
- The Patient app's "What's new" screen reads from `/api/v1/public/app-versions` and prompts users to update.

## TestFlight (iOS)

```bash
pnpm build:eas:production
# Submit to App Store Connect
npx eas submit --platform ios

# Once TestFlight link is ready
pnpm publish:preview \
  --channel=preview \
  --version=0.1.0-preview \
  --ios-url=https://testflight.apple.com/join/<code>
```

## Production (Play Store + App Store)

```bash
pnpm build:eas:production
npx eas submit --platform all

pnpm publish:preview --channel=production --version=$(node -p "require('./app.json').expo.version")
```
