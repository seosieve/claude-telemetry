import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
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
  login: (email: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  token: string | null;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => ({ success: false }),
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
  const [isLoading, setIsLoading] = useState(false);

  // Guest mode — no auth required, always authenticated
  useEffect(() => {
    setIsLoading(false);
  }, []);

  const login = useCallback(
    async (email: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = (await res.json()) as {
          success?: boolean;
          error?: string;
        };
        if (res.ok && data.success) {
          return { success: true };
        }
        if (res.status === 403) {
          return { success: false, error: "This email is not authorized. Contact the admin to request access." };
        }
        return { success: false, error: data.error || "Login failed" };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "Network error",
        };
      }
    },
    [],
  );

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
        login,
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
