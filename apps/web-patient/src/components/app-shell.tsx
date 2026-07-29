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
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      {/* ── Navbar ─────────────────────────────────────────────── */}
      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
          {/* Logo */}
          <Link to="/" className="text-primary flex items-center gap-2 text-xl font-bold">
            <Heart className="fill-primary h-6 w-6" />
            Clary
          </Link>

          {/* Desktop nav */}
          <nav className="ml-6 hidden items-center gap-1 md:flex">
            {navLinks.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg px-3 py-2 text-sm font-medium transition-colors"
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
              className="hover:bg-muted hidden h-9 w-9 items-center justify-center rounded-lg transition-colors sm:flex"
              aria-label="Qidirish"
            >
              <Search className="h-4 w-4" />
            </button>

            {/* Theme toggle */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="hover:bg-muted flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
              aria-label="Mavzu"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {session ? (
              <>
                <Link
                  to="/appointments"
                  className="hover:bg-muted relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
                  aria-label="Bildirishnomalar"
                >
                  <Bell className="h-4 w-4" />
                </Link>
                <Link
                  to="/profile"
                  className="bg-primary/10 text-primary ring-primary/20 hover:bg-primary/20 flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ring-1 transition-colors"
                  aria-label="Profil"
                >
                  <User className="h-4 w-4" />
                </Link>
                <button
                  onClick={handleSignOut}
                  className="hover:bg-muted text-muted-foreground hidden h-9 w-9 items-center justify-center rounded-lg transition-colors sm:flex"
                  aria-label="Chiqish"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/auth/login"
                  className="text-muted-foreground hover:text-foreground hover:bg-muted hidden rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:inline-flex"
                >
                  Kirish
                </Link>
                <Link
                  to="/auth/register"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                >
                  Ro'yxatdan o'tish
                </Link>
              </div>
            )}

            {/* Hamburger */}
            <button
              onClick={() => setMobileOpen(true)}
              className="hover:bg-muted dark:bg-card flex h-10 w-10 items-center justify-center rounded-lg border bg-white shadow-sm transition-colors md:hidden"
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
          <aside className="bg-background fixed bottom-0 right-0 top-0 z-50 flex w-72 flex-col shadow-2xl transition-transform duration-300">
            <div className="flex items-center justify-between border-b p-4">
              <span className="text-primary text-lg font-bold">Menyu</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="hover:bg-muted flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-1 p-3">
              {navLinks.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  onClick={() => setMobileOpen(false)}
                  className="hover:bg-muted flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            {session ? (
              <div className="border-t p-3">
                <button
                  onClick={handleSignOut}
                  className="text-destructive hover:bg-destructive/10 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Chiqish
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 border-t p-3">
                <Link
                  to="/auth/login"
                  onClick={() => setMobileOpen(false)}
                  className="hover:bg-muted flex items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
                >
                  Kirish
                </Link>
                <Link
                  to="/auth/register"
                  onClick={() => setMobileOpen(false)}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
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
      <footer className="bg-muted/30 border-t py-8">
        <div className="text-muted-foreground mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 text-sm sm:flex-row">
          <div className="flex items-center gap-2">
            <Heart className="fill-primary text-primary h-4 w-4" />
            <span>© {new Date().getFullYear()} Clary. Barcha huquqlar himoyalangan.</span>
          </div>
          <div className="flex gap-4">
            <Link to="/legal/terms" className="hover:text-foreground transition-colors">
              Foydalanish shartlari
            </Link>
            <Link to="/legal/privacy" className="hover:text-foreground transition-colors">
              Maxfiylik siyosati
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
