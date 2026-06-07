import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

interface User {
  id: string;
  email: string;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => void;
  token: string | null;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  logout: () => {},
  token: null,
});

import { TOKEN_KEY, REFRESH_KEY } from "../lib/constants";
import { setOnAuthExpired } from "../lib/api";

const GUEST_USER: User = {
  id: "00000000-0000-0000-0000-000000000000",
  email: "guest@local",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(GUEST_USER);
  const [token, setToken] = useState<string | null>("guest");

  // Guest mode — no auth required, always authenticated.
  const isLoading = false;

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }, []);

  // Register global 401 handler so api.ts can trigger logout
  useEffect(() => {
    setOnAuthExpired(() => logout());
  }, [logout]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        logout,
        token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
