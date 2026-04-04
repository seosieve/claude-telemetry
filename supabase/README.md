# Supabase Setup

## 1. Create Project

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Click **New Project** — choose a name and region
3. Wait for the project to provision

## 2. Run Migrations

1. Go to **SQL Editor** in the Supabase Dashboard
2. Paste the contents of [`migrations/001_initial_schema.sql`](migrations/001_initial_schema.sql)
3. Click **Run**

This creates all tables, indexes, RLS policies, and RPC functions.

## 3. Configure Authentication

1. Go to **Authentication** > **URL Configuration**
2. Set **Site URL** to your dashboard URL (e.g., `https://your-app.pages.dev`)
3. Add the same URL to **Redirect URLs**

## 4. Copy Keys

1. Go to **Settings** > **API**
2. Copy:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **service_role key** (starts with `eyJ...`)

These are used as Cloudflare Pages secrets (`SUPABASE_URL` and `SUPABASE_SERVICE_KEY`).

## Schema Overview

| Table | Source | Description |
|---|---|---|
| `machines` | Agent setup | Registered PCs |
| `daily_usage` | ccusage daily | Per-day, per-project, per-model usage |
| `sessions` | ccusage session | Individual conversation sessions |
| `rate_limits` | ccost (optional) | Rate limit window data |
| `stats_extra` | stats-cache.json | Hour counts, activity, model usage |
| `sync_log` | Agent sync | Sync history and errors |
| `users` | Supabase Auth | Dashboard users |
| `machine_owners` | Auto | User-machine ownership |
