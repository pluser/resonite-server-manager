export interface TriggerBuildResult {
  success: boolean;
  message: string;
  dispatchedAt?: number;
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
  const dispatchedAt = Date.now();

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
      dispatchedAt,
    };
  }

  if (response.status === 204) {
    return {
      success: true,
      message: `Build triggered on ref \`${ref}\``,
      dispatchedAt,
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

  return { success: false, message, dispatchedAt };
}

export interface WorkflowRunInfo {
  id: number;
  htmlUrl: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
}

async function fetchLatestRunInfo(options: {
  owner: string;
  repo: string;
  workflowId: string;
  ref: string;
  token: string;
}): Promise<WorkflowRunInfo | null> {
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
      workflow_runs?: Array<{
        id: number;
        html_url: string;
        status: string;
        conclusion: string | null;
        created_at: string;
        updated_at: string;
      }>;
    };

    const run = data.workflow_runs?.[0];
    if (!run) return null;

    return {
      id: run.id,
      htmlUrl: run.html_url,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
    };
  } catch {
    return null;
  }
}

export async function waitForNewWorkflowRun(
  options: {
    owner: string;
    repo: string;
    workflowId: string;
    ref: string;
    token: string;
  },
  dispatchedAt: number,
  pollIntervalMs: number = 5_000,
  maxWaitMs: number = 60_000,
): Promise<WorkflowRunInfo | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const runInfo = await fetchLatestRunInfo(options);
    if (runInfo && new Date(runInfo.createdAt).getTime() > dispatchedAt) {
      return runInfo;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return null;
}

export async function getWorkflowRunStatus(options: {
  owner: string;
  repo: string;
  runId: number;
  token: string;
}): Promise<WorkflowRunInfo | null> {
  const { owner, repo, runId, token } = options;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`;

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
      id: number;
      html_url: string;
      status: string;
      conclusion: string | null;
      created_at: string;
      updated_at: string;
    };

    return {
      id: data.id,
      htmlUrl: data.html_url,
      status: data.status,
      conclusion: data.conclusion,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch {
    return null;
  }
}
