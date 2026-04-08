import { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  fetchPreferences,
  updatePreferences,
  type UserPreferences,
} from "../lib/api";
import { TOKEN_KEY } from "../lib/constants";

const FALLBACK_KEY = "claude_tracker_preferences";

const DEFAULT_PREFS: UserPreferences = {
  user_id: "",
  plan_cost: null,
  plan_name: "none",
  project_budgets: {},
  alert_thresholds: { daily: 20, weekly: 100 },
  week_start_day: "monday",
  theme: "dark",
  notifications: {
    webhook_url: null,
    webhook_enabled: false,
    types: { project_budget: true, rate_limit: true },
  },
  updated_at: "",
};

interface PreferencesContextValue {
  prefs: UserPreferences;
  loading: boolean;
  save: (data: Partial<Omit<UserPreferences, "user_id" | "updated_at">>) => Promise<void>;
}

export const PreferencesContext = createContext<PreferencesContextValue>({
  prefs: DEFAULT_PREFS,
  loading: true,
  save: async () => {},
});

export function usePreferencesProvider() {
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);

  // Load only when authenticated (token exists)
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }

    fetchPreferences()
      .then((data) => {
        setPrefs(data);
        // Migrate localStorage thresholds if they exist
        const localDaily = localStorage.getItem("alert_daily_threshold");
        const localWeekly = localStorage.getItem("alert_weekly_threshold");
        if (localDaily || localWeekly) {
          const thresholds = {
            daily: localDaily ? parseFloat(localDaily) : data.alert_thresholds.daily,
            weekly: localWeekly ? parseFloat(localWeekly) : data.alert_thresholds.weekly,
          };
          // Only migrate if different from defaults
          if (thresholds.daily !== data.alert_thresholds.daily || thresholds.weekly !== data.alert_thresholds.weekly) {
            updatePreferences({ alert_thresholds: thresholds }).then((updated) => {
              setPrefs(updated);
            }).catch((e) => { console.warn("Preferences migration failed:", e.message); });
          }
          // Clear localStorage after migration
          localStorage.removeItem("alert_daily_threshold");
          localStorage.removeItem("alert_weekly_threshold");
        }
      })
      .catch(() => {
        // Fallback to localStorage
        const stored = localStorage.getItem(FALLBACK_KEY);
        if (stored) {
          try {
            setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(stored) });
          } catch {
            // ignore
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(
    async (data: Partial<Omit<UserPreferences, "user_id" | "updated_at">>) => {
      try {
        const updated = await updatePreferences(data);
        setPrefs(updated);
      } catch {
        // Offline fallback: save locally
        const merged = { ...prefs, ...data };
        setPrefs(merged);
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(merged));
      }
    },
    [prefs],
  );

  return { prefs, loading, save };
}

export function usePreferences() {
  return useContext(PreferencesContext);
}
