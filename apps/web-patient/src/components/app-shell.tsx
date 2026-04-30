import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Menu, X, Bell, User, LogOut, Heart, Search, Moon, Sun } from 'lucide-react';

import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { session, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const navLinks = [
    { to: '/clinics', label: 'Klinikalar' },
    { to: '/nurses', label: 'Uyga hamshira' },
    { to: '/appointments', label: 'Navbatlarim' },
  ];

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* ── Navbar ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 font-bold text-xl text-primary">
            <Heart className="h-6 w-6 fill-primary" />
            Clary
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 ml-6">
            {navLinks.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex-1" />

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Search */}
            <button
              onClick={() => navigate('/clinics')}
              className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg hover:bg-muted transition-colors"
              aria-label="Qidirish"
            >
              <Search className="h-4 w-4" />
            </button>

            {/* Theme toggle */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
              aria-label="Mavzu"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {session ? (
              <>
                <Link
                  to="/appointments"
                  className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-muted transition-colors relative"
                  aria-label="Bildirishnomalar"
                >
                  <Bell className="h-4 w-4" />
                </Link>
                <Link
                  to="/profile"
                  className="h-9 w-9 flex items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold ring-1 ring-primary/20 hover:bg-primary/20 transition-colors"
                  aria-label="Profil"
                >
                  <User className="h-4 w-4" />
                </Link>
                <button
                  onClick={handleSignOut}
                  className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground"
                  aria-label="Chiqish"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/auth/login"
                  className="hidden sm:inline-flex px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Kirish
                </Link>
                <Link
                  to="/auth/register"
                  className="inline-flex px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Ro'yxatdan o'tish
                </Link>
              </div>
            )}

            {/* Hamburger */}
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden flex h-10 w-10 items-center justify-center rounded-lg border bg-white shadow-sm hover:bg-muted transition-colors dark:bg-card"
              aria-label="Menyu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile drawer ──────────────────────────────────────── */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed right-0 top-0 bottom-0 z-50 w-72 bg-background shadow-2xl flex flex-col transition-transform duration-300">
            <div className="flex items-center justify-between p-4 border-b">
              <span className="font-bold text-lg text-primary">Menyu</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-col gap-1 p-3 flex-1">
              {navLinks.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-muted transition-colors"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            {session ? (
              <div className="p-3 border-t">
                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Chiqish
                </button>
              </div>
            ) : (
              <div className="p-3 border-t flex flex-col gap-2">
                <Link
                  to="/auth/login"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center justify-center px-4 py-2.5 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
                >
                  Kirish
                </Link>
                <Link
                  to="/auth/register"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center justify-center px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  Ro'yxatdan o'tish
                </Link>
              </div>
            )}
          </aside>
        </>
      )}

      {/* ── Main content ───────────────────────────────────────── */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t bg-muted/30 py-8">
        <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Heart className="h-4 w-4 fill-primary text-primary" />
            <span>© {new Date().getFullYear()} Clary. Barcha huquqlar himoyalangan.</span>
          </div>
          <div className="flex gap-4">
            <Link to="/legal/terms" className="hover:text-foreground transition-colors">Foydalanish shartlari</Link>
            <Link to="/legal/privacy" className="hover:text-foreground transition-colors">Maxfiylik siyosati</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
