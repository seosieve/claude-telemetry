import { db, json, type Env } from "./_lib";

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");

  // Validate UUID format. This endpoint is unauthenticated under guest mode,
  // so reject anything that isn't a well-formed machine id before touching DB.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !uuidRe.test(id)) {
    return json({ error: "valid machine id (uuid) is required" }, 400);
  }

  const sql = db(context.env);

  // Fetch machine name before deactivating (for response)
  const machines = (await sql`
    select name from machines where id = ${id}
  `) as Array<{ name: string }>;

  if (!machines.length) {
    return json({ error: "Machine not found" }, 404);
  }

  const machineName = machines[0].name;

  // Soft-delete: flip is_active=false instead of a hard DELETE. The machines
  // endpoint filters active_only by default, so the machine disappears from the
  // dashboard while its historical usage rows are preserved (no CASCADE wipe).
  // This keeps an unauthenticated call non-destructive and recoverable.
  try {
    await sql`update machines set is_active = false where id = ${id}`;
  } catch (err) {
    return json(
      {
        error: `Failed to deactivate machine: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      500,
    );
  }

  return json({ success: true, deleted: machineName });
};
