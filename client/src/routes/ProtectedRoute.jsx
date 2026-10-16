import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';
import useStore from '../store/useStore';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';

export default function ProtectedRoute({ children }) {
  const accessToken = useStore((s) => s.accessToken);
  const user = useStore((s) => s.user);
  const setAuth = useStore((s) => s.setAuth);
  // Check if we need to bootstrap: no token OR token exists but user not hydrated
  const needsCheck = !accessToken || !user;
  const [checking, setChecking] = useState(needsCheck);

  useEffect(() => {
    if (!needsCheck) { setChecking(false); return; }

    const restore = async () => {
      try {
        let token = accessToken;

        // If no token, try refresh cookie first
        if (!token) {
          const { data: refreshData } = await axios.post(`${BASE}/auth/refresh`, {}, { withCredentials: true });
          token = refreshData && refreshData.data && refreshData.data.accessToken;
          if (!token) return;
          window.__accessToken__ = token;
        }

        // Always fetch fresh user profile to ensure role is current
        const { data: meData } = await axios.get(`${BASE}/users/profile`, {
          headers: { Authorization: `Bearer ${token}` },
          withCredentials: true,
        });
        const restoredUser = meData && meData.data && meData.data.user;
        setAuth(restoredUser || null, token);
      } catch (_) {
        // Session invalid — clear and redirect to login
        setAuth(null, null);
        window.__accessToken__ = null;
      } finally {
        setChecking(false);
      }
    };

    restore();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (checking) return null;
  if (!accessToken || !user) return <Navigate to="/login" replace />;
  return children;
}
