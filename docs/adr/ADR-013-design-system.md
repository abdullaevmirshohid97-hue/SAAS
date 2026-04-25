# ADR-013: Modern design system

- Status: Accepted

## Decision

- **Components**: shadcn/ui (Radix primitives, owned code)
- **Typography**: Geist Sans + Geist Mono (Vercel)
- **Icons**: Lucide Icons
- **Motion**: framer-motion 11
- **Command palette**: cmdk (like Linear)
- **Toasts**: sonner
- **Tables**: TanStack Table v8
- **Charts**: Tremor
- **Forms**: react-hook-form + Zod
- **Code editor (templates)**: Monaco Editor
- **Themes**: light / dark / classic (3 themes, CSS variables)

## Consequences

- Shared design tokens across web-clinic, web-admin, web-landing, mobile (via NativeWind)
- Lighthouse Performance/Accessibility/SEO target: 100 on landing, 95+ on app
- Single component library to maintain
