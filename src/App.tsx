import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { homeFor, RequireRole, useAuth } from './auth/AuthProvider';
import { AppShell } from './components/layout/AppShell';
import { FullScreenLoader, PageLoader } from './components/layout/FullScreenLoader';
import { LoginPage } from './pages/Login';
import { EmployeeDashboard } from './pages/employee/EmployeeDashboard';
import { MyShifts } from './pages/employee/MyShifts';
import { NotFound } from './pages/NotFound';

const Overview = lazy(() => import('./pages/admin/Overview'));
const Shifts = lazy(() => import('./pages/admin/Shifts'));
const Employees = lazy(() => import('./pages/admin/Employees'));
const Analytics = lazy(() => import('./pages/admin/Analytics'));
const Reports = lazy(() => import('./pages/admin/Reports'));
const Devices = lazy(() => import('./pages/admin/Devices'));
const SettingsPage = lazy(() => import('./pages/admin/Settings'));

function Home() {
  const { profile, ready } = useAuth();
  if (!ready) return <FullScreenLoader />;
  return <Navigate to={profile ? homeFor(profile.role) : '/login'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireRole role="employee"><AppShell /></RequireRole>}>
        <Route path="/employee" element={<EmployeeDashboard />} />
        <Route path="/employee/shifts" element={<MyShifts />} />
      </Route>
      <Route element={<RequireRole role="admin"><AppShell /></RequireRole>}>
        {[
          ['/admin', Overview],
          ['/admin/shifts', Shifts],
          ['/admin/employees', Employees],
          ['/admin/analytics', Analytics],
          ['/admin/reports', Reports],
          ['/admin/devices', Devices],
          ['/admin/settings', SettingsPage],
        ].map(([path, Page]) => {
          const C = Page as React.ComponentType;
          return <Route key={path as string} path={path as string} element={<Suspense fallback={<PageLoader />}><C /></Suspense>} />;
        })}
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
