import type React from "react";
import { lazy, useEffect } from "react";
import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { ApiErrorAlert, Shell } from "./components/common";
import {
  PageLoadingFallback,
  RouteOutletBoundary,
  StandaloneRouteBoundary,
} from "./components/layout/RouteBoundary";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import {
  UiLanguageProvider,
  useUiLanguage,
} from "./contexts/UiLanguageContext";
import { useAgentChatStore } from "./stores/agentChatStore";
import "./App.css";

const HomePage = lazy(() => import("./pages/HomePage"));
const StrategyOverviewPage = lazy(() => import("./pages/StrategyOverviewPage"));
const StrategyWorkspacePage = lazy(
  () => import("./pages/StrategyWorkspacePage"),
);
const StrategyEditorPage = lazy(() => import("./pages/StrategyEditorPage"));
const StrategyRunPage = lazy(() => import("./pages/StrategyRunPage"));
const BacktestPage = lazy(() => import("./pages/BacktestPage"));
const SettingsPage = lazy(() => import("./pages/PlatformSettingsPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const ChatPage = lazy(() => import("./pages/ChatPage"));
const PortfolioPage = lazy(() => import("./pages/PortfolioPage"));
const DecisionSignalsPage = lazy(() => import("./pages/DecisionSignalsPage"));
const AlertsPage = lazy(() => import("./pages/AlertsPage"));
const TokenUsagePage = lazy(() => import("./pages/TokenUsagePage"));
const StockScreeningPage = lazy(() => import("./pages/StockScreeningPage"));
const StrategyLibraryPage = lazy(() => import("./pages/StrategyLibraryPage"));
const StrategyValidationPage = lazy(
  () => import("./pages/StrategyValidationPage"),
);
const LiveNewsPage = lazy(() => import("./pages/LiveNewsPage"));
const DataSourcesPage = lazy(() => import("./pages/DataSourcesPage"));
const StrategyDevelopmentGuidePage = lazy(
  () => import("./pages/StrategyDevelopmentGuidePage"),
);
const StrategyImportPage = lazy(() => import("./pages/StrategyImportPage"));

const AppContent: React.FC = () => {
  const location = useLocation();
  const { authEnabled, loggedIn, isLoading, loadError, refreshStatus } =
    useAuth();
  const { t } = useUiLanguage();

  useEffect(() => {
    useAgentChatStore.getState().setCurrentRoute(location.pathname);
  }, [location.pathname]);

  if (isLoading) {
    return <PageLoadingFallback />;
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base px-4">
        <div className="w-full max-w-lg">
          <ApiErrorAlert error={loadError} />
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void refreshStatus()}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  if (authEnabled && !loggedIn) {
    if (location.pathname === "/login") {
      return (
        <StandaloneRouteBoundary>
          <LoginPage />
        </StandaloneRouteBoundary>
      );
    }
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }

  if (location.pathname === "/login") {
    return <Navigate to="/" replace />;
  }

  return (
    <Routes>
      <Route
        element={
          <Shell>
            <RouteOutletBoundary />
          </Shell>
        }
      >
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<StrategyOverviewPage />} />
        <Route path="/legacy-dashboard" element={<HomePage />} />
        <Route path="/stock-research" element={<HomePage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/decision-signals" element={<DecisionSignalsPage />} />
        <Route path="/screening" element={<StockScreeningPage />} />
        <Route path="/backtest" element={<BacktestPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/usage" element={<TokenUsagePage />} />
        <Route path="/simulation" element={<Navigate to="/runs" replace />} />
        <Route
          path="/strategy-editor"
          element={<Navigate to="/strategies" replace />}
        />
        <Route path="/runs/preview" element={<Navigate to="/runs" replace />} />
        <Route path="/strategies" element={<StrategyLibraryPage />} />
        <Route path="/agents" element={<Navigate to="/strategies" replace />} />
        <Route path="/strategy-development" element={<StrategyDevelopmentGuidePage />} />
        <Route path="/strategies/import" element={<StrategyImportPage />} />
        <Route
          path="/strategies/:strategyId"
          element={<StrategyWorkspacePage />}
        />
        <Route
          path="/strategies/:strategyId/editor"
          element={<StrategyEditorPage />}
        />
        <Route
          path="/strategies/:strategyId/versions"
          element={<StrategyWorkspacePage />}
        />
        <Route
          path="/strategies/:strategyId/memory"
          element={<StrategyWorkspacePage />}
        />
        <Route path="/validation" element={<StrategyValidationPage />} />
        <Route path="/research" element={<StrategyValidationPage />} />
        <Route path="/backtests" element={<StrategyValidationPage />} />
        <Route path="/runs" element={<StrategyRunPage />} />
        <Route path="/runs/:runId" element={<StrategyRunPage />} />
        <Route path="/news" element={<LiveNewsPage />} />
        <Route path="/data-sources" element={<DataSourcesPage />} />
        <Route path="/data" element={<DataSourcesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <UiLanguageProvider>
      <Router>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </Router>
    </UiLanguageProvider>
  );
};

export default App;
