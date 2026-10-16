import { Navigate } from 'react-router-dom';
import useStore from '../store/useStore';

const roleHome = { student: '/student', admin: '/admin', principal: '/principal' };

export default function RoleRoute({ role, children }) {
  const user = useStore((s) => s.user);
  const accessToken = useStore((s) => s.accessToken);

  // Token exists but user not yet hydrated — wait
  if (accessToken && !user) return null;

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={roleHome[user.role] || '/login'} replace />;
  return children;
}
