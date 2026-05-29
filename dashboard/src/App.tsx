import { useState, useEffect, useMemo } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { MachineFilterProvider } from "./hooks/useMachineFilter";
import { PreferencesContext, usePreferencesProvider } from "./hooks/usePreferences";
import { useUsageData } from "./hooks/useUsageData";
import { useAlertThresholds } from "./hooks/useAlertThresholds";
import { daysAgo, today } from "./lib/dateUtils";
import { Layout } from "./components/layout/Layout";
import { Spinner } from "./components/Spinner";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { Daily } from "./pages/Daily";
import { Blocks } from "./pages/Blocks";
import { Projects } from "./pages/Projects";
import { Models } from "./pages/Models";
import { Machines } from "./pages/Machines";
import { Deploy } from "./pages/Deploy";
import { Sessions } from "./pages/Sessions";
import { Insights } from "./pages/Insights";
import { Settings } from "./pages/Settings";

const PAGE_TITLES: Record<string, string> = {
  overview: "Overview",
  daily: "Daily Usage",
  blocks: "5-Hour Blocks",
  projects: "Projects",
  models: "Models",
  machines: "Machines",
  deploy: "Deploy Agent",
  sessions: "Sessions",
  insights: "Insights",
  settings: "Settings",
};

function PageRouter({ page }: { page: string }) {
  switch (page) {
    case "daily":
      return <Daily />;
    case "blocks":
      return <Blocks />;
    case "projects":
      return <Projects />;
    case "models":
      return <Models />;
    case "machines":
      return <Machines />;
    case "deploy":
      return <Deploy />;
    case "sessions":
      return <Sessions />;
    case "insights":
      return <Insights />;
    case "settings":
      return <Settings />;
    default:
      return <Overview />;
  }
}

function AuthenticatedApp() {
  const { isAuthenticated, isLoading } = useAuth();

  const [page, setPage] = useState(() => {
    const hash = window.location.hash.slice(1);
    // Don't use auth-callback as a page
    if (hash.startsWith("auth-callback")) return "overview";
    return hash || "overview";
  });

  const navigate = (newPage: string) => {
    setPage(newPage);
    window.location.hash = newPage;
  };

  // Sync page state when hash changes externally (e.g. <a href="#deploy">)
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash && !hash.startsWith("auth-callback") && hash !== page) {
        setPage(hash);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [page]);

  // All hooks MUST be called before any conditional returns (React rules of hooks)
  const prefsCtx = usePreferencesProvider();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner size="md" />
          Loading...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <PreferencesContext.Provider value={prefsCtx}>
      <MachineFilterProvider>
        <DashboardShell page={page} onNavigate={navigate} />
      </MachineFilterProvider>
    </PreferencesContext.Provider>
  );
}

function DashboardShell({ page, onNavigate }: { page: string; onNavigate: (p: string) => void }) {
  const dateRange = useMemo(() => ({ start: daysAgo(14), end: today() }), []);
  const { summary } = useUsageData(dateRange);
  const alerts = useAlertThresholds(summary);

  return (
    <Layout
      title={PAGE_TITLES[page] || "Overview"}
      activePage={page}
      onNavigate={onNavigate}
      alertCount={alerts.length}
    >
      <PageRouter page={page} />
    </Layout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </ErrorBoundary>
  );
}
