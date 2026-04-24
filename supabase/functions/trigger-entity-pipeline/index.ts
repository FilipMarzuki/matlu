/**
 * Supabase Edge Function: receives Database Webhook payloads for `creature_submissions`
 * INSERT events and dispatches the GitHub Actions workflow `submission-to-entity.yml`
 * with the new row's UUID.
 *
 * Secrets: `GH_TRACKER_TOKEN` (PAT able to dispatch that workflow on FilipMarzuki/matlu).
 * Deploy, webhook, and header setup: see CLAUDE.md → "Submission to Entity".
 */
const GITHUB_API_VERSION = "2022-11-28";
const WORKFLOW_DISPATCH_URL =
  "https://api.github.com/repos/FilipMarzuki/matlu/actions/workflows/submission-to-entity.yml/dispatches";

/** Shape sent by Supabase Database Webhooks (INSERT on a table). */
interface DatabaseInsertPayload {
  type: string;
  schema: string;
  table: string;
  record: unknown;
  old_record: unknown;
}

function isDatabaseInsertPayload(value: unknown): value is DatabaseInsertPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "table" in value &&
    "record" in value
  );
}

function isRecordWithStringId(record: unknown): record is { id: string } {
  return (
    typeof record === "object" &&
    record !== null &&
    "id" in record &&
    typeof (record as { id: unknown }).id === "string" &&
    (record as { id: string }).id.length > 0
  );
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    console.error("trigger-entity-pipeline: failed to parse JSON body", err);
    return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isDatabaseInsertPayload(body)) {
    console.error("trigger-entity-pipeline: unexpected payload shape");
    return new Response(JSON.stringify({ ok: false, error: "invalid_payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (body.table !== "creature_submissions" || body.type !== "INSERT") {
    console.log(
      "trigger-entity-pipeline: skipping",
      { type: body.type, table: body.table },
    );
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isRecordWithStringId(body.record)) {
    console.error("trigger-entity-pipeline: INSERT payload missing record.id");
    return new Response(JSON.stringify({ ok: false, error: "missing_record_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const submissionId = body.record.id;

  const ghToken = Deno.env.get("GH_TRACKER_TOKEN");
  if (!ghToken) {
    console.error("trigger-entity-pipeline: GH_TRACKER_TOKEN is not set");
    return new Response(JSON.stringify({ ok: false, error: "missing_gh_secret" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch(WORKFLOW_DISPATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "Content-Type": "application/json",
        "User-Agent": "matlu-trigger-entity-pipeline",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { submission_id: submissionId },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(
        "trigger-entity-pipeline: GitHub API error",
        res.status,
        detail,
      );
      return new Response(
        JSON.stringify({
          ok: false,
          error: "github_dispatch_failed",
          status: res.status,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, submission_id: submissionId }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("trigger-entity-pipeline: request to GitHub failed", err);
    return new Response(
      JSON.stringify({ ok: false, error: "github_request_failed" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
});
