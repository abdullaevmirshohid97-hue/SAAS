# Mobile release

## Channels

- **development** — devs only
- **preview** — QA team via TestFlight + Play Internal
- **production** — App Store + Play Store

## EAS build

```bash
cd apps/mobile
eas build --platform all --profile preview
eas submit --platform all --profile preview  # push to internal track
```

## OTA (JS-only updates)

```bash
eas update --channel production --message "Fix queue crash"
```

OTA is restricted to bug fixes; schema-changing updates require a new build.
