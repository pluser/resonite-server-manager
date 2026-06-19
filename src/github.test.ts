import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { triggerWorkflowDispatch, getWorkflowRunStatus } from "./github.js";

const originalFetch = globalThis.fetch;

function mockFetch(responses: Array<{ status: number; body?: unknown; ok?: boolean }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const res = responses[callIndex] ?? { status: 500 };
    callIndex++;
    return {
      status: res.status,
      ok: res.ok ?? (res.status >= 200 && res.status < 300),
      statusText: res.status === 204 ? "No Content" : "Error",
      text: async () => (res.body ? JSON.stringify(res.body) : ""),
      json: async () => res.body,
    } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("triggerWorkflowDispatch", () => {
  it("returns success on 204 response", async () => {
    globalThis.fetch = mockFetch([
      { status: 204 },
      { status: 200, body: { workflow_runs: [{ id: 12345, html_url: "https://github.com/owner/repo/actions/runs/123", status: "queued", conclusion: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }] } },
    ]);

    const result = await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "main",
      token: "test-token",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("main");
    expect(result.runUrl).toBe("https://github.com/owner/repo/actions/runs/123");
    expect(result.runId).toBe(12345);
  });

  it("returns success without runUrl/runId when run fetch fails", async () => {
    globalThis.fetch = mockFetch([
      { status: 204 },
      { status: 500 },
    ]);

    const result = await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "main",
      token: "test-token",
    });

    expect(result.success).toBe(true);
    expect(result.runUrl).toBeUndefined();
    expect(result.runId).toBeUndefined();
  });

  it("returns failure on 401", async () => {
    globalThis.fetch = mockFetch([{ status: 401 }]);

    const result = await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "main",
      token: "bad-token",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("authentication");
  });

  it("returns failure on 404", async () => {
    globalThis.fetch = mockFetch([{ status: 404 }]);

    const result = await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "main",
      token: "test-token",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("returns failure on 422", async () => {
    globalThis.fetch = mockFetch([{ status: 422 }]);

    const result = await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "nonexistent-branch",
      token: "test-token",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid request");
  });

  it("returns failure on network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const result = await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "main",
      token: "test-token",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Network error");
  });

  it("sends correct request body with inputs", async () => {
    const fetchMock = mockFetch([
      { status: 204 },
      { status: 200, body: { workflow_runs: [] } },
    ]);
    globalThis.fetch = fetchMock;

    await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "v1.0.0",
      token: "test-token",
      inputs: { version: "1.0.0" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/actions/workflows/docker.yml/dispatches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ref: "v1.0.0", inputs: { version: "1.0.0" } }),
      }),
    );
  });
});

describe("getWorkflowRunStatus", () => {
  it("returns run info on success", async () => {
    globalThis.fetch = mockFetch([
      { status: 200, body: { id: 999, html_url: "https://github.com/owner/repo/actions/runs/999", status: "in_progress", conclusion: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:01:00Z" } },
    ]);

    const result = await getWorkflowRunStatus({
      owner: "owner",
      repo: "repo",
      runId: 999,
      token: "test-token",
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(999);
    expect(result!.status).toBe("in_progress");
    expect(result!.conclusion).toBeNull();
  });

  it("returns null on error", async () => {
    globalThis.fetch = mockFetch([{ status: 404 }]);

    const result = await getWorkflowRunStatus({
      owner: "owner",
      repo: "repo",
      runId: 999,
      token: "test-token",
    });

    expect(result).toBeNull();
  });

  it("returns run info with completed status", async () => {
    globalThis.fetch = mockFetch([
      { status: 200, body: { id: 999, html_url: "https://github.com/owner/repo/actions/runs/999", status: "completed", conclusion: "success", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:05:00Z" } },
    ]);

    const result = await getWorkflowRunStatus({
      owner: "owner",
      repo: "repo",
      runId: 999,
      token: "test-token",
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe("completed");
    expect(result!.conclusion).toBe("success");
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("triggerWorkflowDispatch", () => {
  it("returns success on 204 response", async () => {
    globalThis.fetch = mockFetch([
      { status: 204 },
      { status: 200, body: { workflow_runs: [{ id: 12345, html_url: "https://github.com/owner/repo/actions/runs/123", status: "queued", conclusion: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }] } },
    ]);

    const result = await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "main",
      token: "test-token",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("main");
    expect(result.runUrl).toBe("https://github.com/owner/repo/actions/runs/123");
    expect(result.runId).toBe(12345);
  });

  it("returns success without runUrl/runId when run fetch fails", async () => {
    globalThis.fetch = mockFetch([
      { status: 204 },
      { status: 500 },
    ]);

    const result = await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "main",
      token: "test-token",
    });

    expect(result.success).toBe(true);
    expect(result.runUrl).toBeUndefined();
    expect(result.runId).toBeUndefined();
  });

  it("returns failure on 401", async () => {
    globalThis.fetch = mockFetch([{ status: 401 }]);

    const result = await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "main",
      token: "bad-token",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("authentication");
  });

  it("returns failure on 404", async () => {
    globalThis.fetch = mockFetch([{ status: 404 }]);

    const result = await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "main",
      token: "test-token",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("returns failure on 422", async () => {
    globalThis.fetch = mockFetch([{ status: 422 }]);

    const result = await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "nonexistent-branch",
      token: "test-token",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid request");
  });

  it("returns failure on network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const result = await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "main",
      token: "test-token",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Network error");
  });

  it("sends correct request body with inputs", async () => {
    const fetchMock = mockFetch([
      { status: 204 },
      { status: 200, body: { workflow_runs: [] } },
    ]);
    globalThis.fetch = fetchMock;

    await triggerWorkflowDispatch({
      owner: "owner",
      repo: "repo",
      workflowId: "docker.yml",
      ref: "v1.0.0",
      token: "test-token",
      inputs: { version: "1.0.0" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/actions/workflows/docker.yml/dispatches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ref: "v1.0.0", inputs: { version: "1.0.0" } }),
      }),
    );
  });
});

describe("getWorkflowRunStatus", () => {
  it("returns run info on success", async () => {
    globalThis.fetch = mockFetch([
      { status: 200, body: { id: 999, html_url: "https://github.com/owner/repo/actions/runs/999", status: "in_progress", conclusion: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:01:00Z" } },
    ]);

    const result = await getWorkflowRunStatus({
      owner: "owner",
      repo: "repo",
      runId: 999,
      token: "test-token",
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(999);
    expect(result!.status).toBe("in_progress");
    expect(result!.conclusion).toBeNull();
  });

  it("returns null on error", async () => {
    globalThis.fetch = mockFetch([{ status: 404 }]);

    const result = await getWorkflowRunStatus({
      owner: "owner",
      repo: "repo",
      runId: 999,
      token: "test-token",
    });

    expect(result).toBeNull();
  });

  it("returns run info with completed status", async () => {
    globalThis.fetch = mockFetch([
      { status: 200, body: { id: 999, html_url: "https://github.com/owner/repo/actions/runs/999", status: "completed", conclusion: "success", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:05:00Z" } },
    ]);

    const result = await getWorkflowRunStatus({
      owner: "owner",
      repo: "repo",
      runId: 999,
      token: "test-token",
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe("completed");
    expect(result!.conclusion).toBe("success");
  });
});
