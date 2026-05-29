import { createContext, useContext, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

const PREFS_KEY = ["preferences"];

async function loadPreferences(): Promise<UserPreferences> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return DEFAULT_PREFS;
  try {
    const data = await fetchPreferences();
    const localDaily = localStorage.getItem("alert_daily_threshold");
    const localWeekly = localStorage.getItem("alert_weekly_threshold");
    if (localDaily || localWeekly) {
      const thresholds = {
        daily: localDaily ? parseFloat(localDaily) : data.alert_thresholds.daily,
        weekly: localWeekly ? parseFloat(localWeekly) : data.alert_thresholds.weekly,
      };
      if (
        thresholds.daily !== data.alert_thresholds.daily ||
        thresholds.weekly !== data.alert_thresholds.weekly
      ) {
        try {
          const updated = await updatePreferences({ alert_thresholds: thresholds });
          localStorage.removeItem("alert_daily_threshold");
          localStorage.removeItem("alert_weekly_threshold");
          return updated;
        } catch (e) {
          console.warn("Preferences migration failed:", (e as Error).message);
        }
      }
      localStorage.removeItem("alert_daily_threshold");
      localStorage.removeItem("alert_weekly_threshold");
    }
    return data;
  } catch {
    const stored = localStorage.getItem(FALLBACK_KEY);
    if (stored) {
      try {
        return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
      } catch {
        // ignore
      }
    }
    return DEFAULT_PREFS;
  }
}

export function usePreferencesProvider() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<UserPreferences>({
    queryKey: PREFS_KEY,
    queryFn: loadPreferences,
  });
  const prefs = data ?? DEFAULT_PREFS;

  const save = useCallback(
    async (data: Partial<Omit<UserPreferences, "user_id" | "updated_at">>) => {
      try {
        const updated = await updatePreferences(data);
        queryClient.setQueryData(PREFS_KEY, updated);
      } catch {
        const merged = { ...prefs, ...data };
        queryClient.setQueryData(PREFS_KEY, merged);
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(merged));
      }
    },
    [prefs, queryClient],
  );

  return { prefs, loading: isLoading, save };
}

export function usePreferences() {
  return useContext(PreferencesContext);
}
