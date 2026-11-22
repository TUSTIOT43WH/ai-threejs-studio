import { useEffect } from 'react';
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { ConceptsPage } from './pages/ConceptsPage';
import { LandingPage } from './pages/LandingPage';
import { StudioPage } from './pages/StudioPage';
import { SettingsPage } from './pages/SettingsPage';
import { BrandMark, PhaseBadge } from './components/ui/primitives';
import { BackgroundJobs } from './components/studio/BackgroundJobs';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function NotFoundPage() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#07090d] px-6 text-white">
      <div className="pointer-events-none absolute inset-0 app-background opacity-60" />
      <div className="relative z-10 flex max-w-md flex-col items-center text-center">
        <BrandMark />
        <div className="mt-8 font-display text-6xl font-semibold tracking-tight text-white/12">
          404
        </div>
        <h1 className="mt-3 text-base font-medium text-white/80">
          这个页面不在当前世界里
        </h1>
        <p className="mt-2 text-[11px] leading-5 text-white/35">
          链接可能已失效，或项目已被移除。返回首页重新开始：一句话生成概念图，再进入可编辑的 3D 世界。
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Link
            to="/"
            className="focus-ring rounded-lg bg-gradient-to-r from-mint-300 to-teal-200 px-4 py-2 text-[11px] font-semibold text-[#06201d]"
          >
            返回首页
          </Link>
          <PhaseBadge />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <BackgroundJobs />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="/projects/:projectId/concepts"
          element={<ConceptsPage />}
        />
        <Route path="/projects/:projectId/studio" element={<StudioPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
