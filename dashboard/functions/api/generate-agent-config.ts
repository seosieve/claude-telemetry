import { db, json, type Env } from "./_lib";

function generateUUID(): string {
  return crypto.randomUUID();
}

function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `ct_${hex}`;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json()) as {
    name?: string;
    os?: string;
  };

  if (!body.name) {
    return json({ error: "name is required" }, 400);
  }

  const machine_id = generateUUID();
  const api_key = generateApiKey();

  // Register the machine in Neon.
  try {
    const sql = db(context.env);
    await sql`
      insert into machines (id, name, api_key, os, hostname)
      values (${machine_id}, ${body.name}, ${api_key}, ${body.os || null}, ${body.name})
    `;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: `Failed to register machine: ${message}` }, 500);
  }

  // NOTE: never return a DB credential here. With the guest-mode middleware
  // this endpoint is unauthenticated, so echoing the connection string / any
  // master key would hand the DB to anyone who knows the URL. The agent gets
  // its DATABASE_URL out-of-band during setup, not from this response.
  return json({
    machine_id,
    api_key,
  });
};
