import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Warehouse from './pages/Warehouse';
import Machines from './pages/Machines';
import Analytics from './pages/Analytics';
import Procurement from './pages/Procurement';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

export default function App() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="artikli" element={<Products />} />
        <Route path="skladiste" element={<Warehouse />} />
        <Route path="automati" element={<Machines />} />
        <Route path="automati/:id" element={<Machines />} />
        <Route path="analitika" element={<Analytics />} />
        <Route path="nabava" element={<Procurement />} />
        <Route path="izvjestaji" element={<Reports />} />
        <Route path="postavke" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
