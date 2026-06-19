export interface TriggerBuildResult {
  success: boolean;
  message: string;
  runUrl?: string;
}

export async function triggerWorkflowDispatch(options: {
  owner: string;
  repo: string;
  workflowId: string;
  ref: string;
  token: string;
  inputs?: Record<string, string>;
}): Promise<TriggerBuildResult> {
  const { owner, repo, workflowId, ref, token, inputs } = options;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`;

  const body: Record<string, unknown> = { ref };
  if (inputs && Object.keys(inputs).length > 0) {
    body.inputs = inputs;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      success: false,
      message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (response.status === 204) {
    const runUrl = await fetchLatestRunUrl({ owner, repo, workflowId, ref, token });
    return {
      success: true,
      message: `Build triggered on ref \`${ref}\``,
      runUrl: runUrl ?? undefined,
    };
  }

  let errorBody = "";
  try {
    errorBody = await response.text();
  } catch {}

  let message: string;
  switch (response.status) {
    case 401:
      message = "GitHub authentication failed. Check your PAT permissions (requires `repo` scope).";
      break;
    case 403:
      message = "GitHub API access forbidden.";
      break;
    case 404:
      message = `Repository or workflow not found: \`${owner}/${repo}\` / \`${workflowId}\``;
      break;
    case 422:
      message = `Invalid request (ref \`${ref}\` may not exist).`;
      break;
    default:
      message = `GitHub API error (${response.status}): ${errorBody || response.statusText}`;
  }

  return { success: false, message };
}

async function fetchLatestRunUrl(options: {
  owner: string;
  repo: string;
  workflowId: string;
  ref: string;
  token: string;
}): Promise<string | null> {
  const { owner, repo, workflowId, ref, token } = options;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?branch=${encodeURIComponent(ref)}&per_page=1&event=workflow_dispatch`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      workflow_runs?: Array<{ html_url: string; created_at: string }>;
    };
    return data.workflow_runs?.[0]?.html_url ?? null;
  } catch {
    return null;
  }
}
