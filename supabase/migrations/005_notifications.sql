-- Add notification preferences column to user_preferences
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS notifications JSONB DEFAULT '{
  "webhook_url": null,
  "webhook_enabled": false,
  "types": {
    "project_budget": true,
    "rate_limit": true
  }
}';

-- Notification history table
CREATE TABLE notification_history (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id),
    type TEXT NOT NULL,
    title TEXT,
    body TEXT,
    sent_at TIMESTAMPTZ DEFAULT now(),
    channel TEXT NOT NULL DEFAULT 'webhook'
);

ALTER TABLE notification_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
    ON notification_history FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Service can insert notifications"
    ON notification_history FOR INSERT
    WITH CHECK (true);

-- Index for anti-spam check (max 1 per type per day)
CREATE INDEX idx_notif_user_type_sent
    ON notification_history(user_id, type, sent_at DESC);
