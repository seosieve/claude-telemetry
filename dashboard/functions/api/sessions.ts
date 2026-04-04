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
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const per_page = parseInt(url.searchParams.get("per_page") || "20", 10);
  const sort = url.searchParams.get("sort") || "cost_usd";
  const order = url.searchParams.get("order") || "desc";

  const offset = (page - 1) * per_page;

  const filters: string[] = [];
  if (machine_id) filters.push(`machine_id=eq.${machine_id}`);
  if (project) filters.push(`project=eq.${project}`);
  if (model) filters.push(`models=cs.{${model}}`);
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
