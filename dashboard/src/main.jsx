import { StrictMode, useState, useEffect, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './clipedit.css'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { capture as captureAttribution } from './lib/attribution'
import LoginModal from './components/LoginModal'
import { readPendingPlan } from './lib/pendingPlan'
import { applyConsent } from './lib/consent'
import CookieBanner from './components/CookieBanner'

const App = lazy(() => import('./App.jsx'))
const Legal = lazy(() => import('./Legal.jsx'))
const PricingPage = lazy(() => import('./components/PricingPage'))
const AccountPage = lazy(() => import('./components/AccountPage'))

function PageShell({ title, children }) {
  return (
    <div className="min-h-screen bg-paper text-ink2">
      <header className="h-14 sm:h-16 border-b border-rule bg-paper flex items-center justify-between gap-3 px-4 sm:px-6 sticky top-0 z-20">
        <a href="#app" className="clipedit-wordmark truncate">Clipedit</a>
        <a href="#app" className="text-sm lowercase text-muted hover:text-ink transition-colors shrink-0">← <span className="hidden sm:inline">Kembali ke aplikasi</span><span className="sm:hidden">Kembali</span></a>
      </header>
      <main className="p-4 sm:p-6 md:p-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {title && <h1 className="font-display lowercase text-2xl sm:text-3xl text-ink text-center mb-6 sm:mb-10">{title}</h1>}
        {children}
      </main>
    </div>
  );
}

function PricingView() {
  const { isSignedIn, loading } = useAuth();
  // A plan picked on the landing while signed out lands here: ask for the
  // sign-in straight away instead of a second click on the same plan.
  const [showLogin, setShowLogin] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => {
    if (!loading && !isSignedIn && readPendingPlan()) setShowLogin(true);
  }, [loading, isSignedIn]);
  return (
    <PageShell>
      <PricingPage onRequireLogin={() => setShowLogin(true)} />
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </PageShell>
  );
}

function AccountView() {
  const { isSignedIn, loading } = useAuth();
  useEffect(() => {
    if (!loading && !isSignedIn) window.location.hash = '#/pricing';
  }, [loading, isSignedIn]);
  return <PageShell><AccountPage /></PageShell>;
}

// Landing spot after an account is erased. Its own view because the session is
// gone: sending the user to #/account would bounce them to pricing with no
// explanation, and "openshorts_skip_landing" would send them into the app.
function DeletedView() {
  return (
    <div className="min-h-screen bg-paper text-ink2 flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="font-display lowercase text-2xl sm:text-3xl text-ink">Akun Anda telah dihapus</h1>
        <p className="text-sm">
          Proyek, klip, dan transkrip telah dihapus. Langganan dibatalkan dan kunci API tidak lagi berfungsi. Konfirmasi lengkap telah dikirim melalui email.
        </p>
        <p className="text-sm text-muted">
          Anda dapat mendaftar kembali kapan saja. Alamat email yang sama akan membuat akun baru yang kosong.
        </p>
        <a href="#app" className="btn-ghost px-4 py-2 inline-flex">Kembali ke pembuat klip</a>
      </div>
    </div>
  );
}

function resolveView(billingEnabled) {
  const hash = window.location.hash || '';
  if (hash === '#legal') return 'legal';
  if (billingEnabled) {
    if (hash.startsWith('#/auth/')) return 'auth';       // AuthContext consumes then redirects
    if (hash.startsWith('#/account')) return 'account';
    if (hash.startsWith('#/deleted')) return 'deleted';
    if (hash.startsWith('#/pricing')) return 'pricing';
  }
  return 'app';
}

function Root() {
  const { billingEnabled } = useAuth();
  const [view, setView] = useState(() => resolveView(billingEnabled));

  useEffect(() => {
    const handleHashChange = () => setView(resolveView(billingEnabled));
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [billingEnabled]);

  if (view === 'legal') return <Legal />;
  if (view === 'pricing') return <PricingView />;
  if (view === 'account') return <AccountView />;
  if (view === 'deleted') return <DeletedView />;
  if (view === 'auth') {
    return <div className="min-h-screen flex items-center justify-center bg-background text-zinc-400">Sedang masuk…</div>;
  }
  return <App />;
}

// Before React mounts: AuthContext rewrites the URL on auth redirects, which
// would destroy the referrer and any UTM params we still need to read.
captureAttribution();

// Start whatever the visitor previously agreed to. Nothing at all on a first
// visit: index.html only publishes the analytics initialiser, it never runs it.
applyConsent();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <Suspense fallback={<div className="min-h-screen bg-paper flex items-center justify-center text-muted text-sm lowercase">Memuat…</div>}>
        <Root />
      </Suspense>
      <CookieBanner />
    </AuthProvider>
  </StrictMode>,
)
