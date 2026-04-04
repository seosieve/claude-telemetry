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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY),
  );
  const [isLoading, setIsLoading] = useState(true);

  // Validate token on mount and after callback
  const validateToken = useCallback(async (t: string) => {
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { id: string; email: string };
        setUser({ id: data.id, email: data.email });
        setToken(t);
        localStorage.setItem(TOKEN_KEY, t);
        return true;
      }
    } catch {
      // Token invalid
    }
    // Clear invalid token
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    return false;
  }, []);

  // Check for auth callback tokens in URL hash
  useEffect(() => {
    const hash = window.location.hash;

    if (hash.includes("auth-callback") || hash.includes("access_token")) {
      // Parse tokens from hash: could be #auth-callback?access_token=... or #access_token=...
      const paramString = hash.includes("?")
        ? hash.split("?")[1]
        : hash.slice(1);
      const params = new URLSearchParams(paramString);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken) {
        if (refreshToken) {
          localStorage.setItem(REFRESH_KEY, refreshToken);
        }
        validateToken(accessToken).finally(() => {
          // Clean up the URL — replaceState prevents token in browser history
          window.history.replaceState({}, "", window.location.pathname);
          setIsLoading(false);
        });
        return;
      }
    }

    // Try existing token
    const savedToken = localStorage.getItem(TOKEN_KEY);
    if (savedToken) {
      validateToken(savedToken).finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [validateToken]);

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
