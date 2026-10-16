import { createContext, useContext, useEffect } from 'react';
import useStore from '../store/useStore';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const accessToken = useStore((s) => s.accessToken);

  // Keep window token in sync with store
  useEffect(() => {
    if (accessToken) {
      window.__accessToken__ = accessToken;
    }
  }, [accessToken]);

  return <AuthContext.Provider value={{}}>{children}</AuthContext.Provider>;
};

export const useAuthContext = () => useContext(AuthContext);
