interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const machine_id = url.searchParams.get("machine_id");
  const project = url.searchParams.get("project");
  const model = url.searchParams.get("model");
  const is_subagent = url.searchParams.get("is_subagent");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const per_page = Math.min(100, Math.max(1, parseInt(url.searchParams.get("per_page") || "20", 10) || 20));
  const ALLOWED_SORT = ["cost_usd", "total_tokens", "last_activity_at", "input_tokens", "output_tokens"];
  const sort = ALLOWED_SORT.includes(url.searchParams.get("sort") || "") ? url.searchParams.get("sort")! : "cost_usd";
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";

  const offset = (page - 1) * per_page;

  // Sanitize filter values — only allow UUID format for machine_id
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const filters: string[] = [];
  if (machine_id && uuidRe.test(machine_id)) filters.push(`machine_id=eq.${machine_id}`);
  if (project) filters.push(`project=eq.${encodeURIComponent(project)}`);
  if (model) filters.push(`models=cs.{${encodeURIComponent(model)}}`);
  if (is_subagent === "true") filters.push("is_subagent=eq.true");
  if (is_subagent === "false") filters.push("is_subagent=eq.false");

  const filterQuery = filters.length > 0 ? `&${filters.join("&")}` : "";

  // Get total count
  const countResponse = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/sessions?select=id${filterQuery}`,
    {
      method: "HEAD",
      headers: {
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
        Prefer: "count=exact",
      },
    },
  );
  const contentRange = countResponse.headers.get("content-range") || "*/0";
  const total = parseInt(contentRange.split("/").pop() || "0", 10);

  // Get paginated data
  const dataResponse = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/sessions?order=${sort}.${order}.nullslast&offset=${offset}&limit=${per_page}${filterQuery}`,
    {
      headers: {
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
      },
    },
  );

  const data = await dataResponse.json();

  return new Response(
    JSON.stringify({ data, total, page, per_page }),
    {
      status: dataResponse.status,
      headers: { "Content-Type": "application/json" },
    },
  );
};
