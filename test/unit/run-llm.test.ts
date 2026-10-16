/**
 * runLLM routing and the MODEL_CHOICES picker contract.
 *
 * The router is one `if` with a big blast radius: a @cf model that
 * accidentally gains the gateway option, or a gateway model that loses it,
 * still looks fine in dev and only fails (or double-bills) against real
 * providers. These tests pin the exact call shape per branch — binding for
 * @cf and native third-party models, fetch to the gateway compat endpoint
 * (Codra-style BYOK) for custom-* models. The MODEL_CHOICES checks pin the
 * settings-UI promise: each chat-model list must be non-empty, hold non-empty
 * strings, and include that setting's shipped default, or the picker renders
 * the default as a "Custom" row.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { runLLM, readStreamText } from "../../src/lib/ai";
import { DEFAULTS, MODEL_CHOICES } from "../../src/config";
import type { Env } from "../../src/env";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** runLLM reads only env.AI, env.AI_GATEWAY, env.CF_ACCOUNT_ID, and the
 * custom-provider key secrets, so the double stays this small. */
type FakeAI = { run: (...args: unknown[]) => Promise<unknown> };

/**
 * An env whose AI binding records each run() call, args array included, so
 * arity (two vs three arguments) is observable, and resolves to `result`.
 * Extra fields (CF_ACCOUNT_ID, CUSTOM_LLM_KEY_ZAI, …) merge in as given.
 */
function makeRunEnv(result: unknown = "unused", extra: Partial<Env> = {}): { env: Env; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const fakeAI: FakeAI = {
    run: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve(result);
    },
  };
  // Partial double: only the members runLLM reads are present, hence the cast.
  const env = { AI: fakeAI, ...extra } as unknown as Env;
  return { env, calls };
}

/** A fetch double that records the request and resolves to `resp`. */
function stubFetch(resp: Response) {
  const fetchMock = vi.fn().mockResolvedValue(resp);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("runLLM()", () => {
  it("runs a @cf model directly: exactly two args, no gateway option", async () => {
    const { env, calls } = makeRunEnv();
    const input = { messages: [{ role: "user", content: "hi" }] };

    await runLLM(env, "@cf/meta/llama-4-scout-17b-16e-instruct", input);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(calls[0][0]).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(calls[0][1]).toBe(input);
  });

  it("routes a native third-party model through AI Gateway id 'default' when env.AI_GATEWAY is unset", async () => {
    const { env, calls } = makeRunEnv();
    const input = { messages: [{ role: "user", content: "hi" }] };

    await runLLM(env, "openai/gpt-5.5", input);

    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 2)).toEqual(["openai/gpt-5.5", input]);
    expect(calls[0][2]).toEqual({ gateway: { id: "default" } });
  });

  it("uses env.AI_GATEWAY as the gateway id when set", async () => {
    const { env, calls } = makeRunEnv("unused", { AI_GATEWAY: "my-gw" });

    await runLLM(env, "openai/gpt-5.5", { messages: [] });

    expect(calls[0][2]).toEqual({ gateway: { id: "my-gw" } });
  });

  it("resolves to whatever env.AI.run resolves to", async () => {
    const sentinel = { answer: "stream-or-object" };
    const { env } = makeRunEnv(sentinel);

    await expect(runLLM(env, "@cf/openai/gpt-oss-120b", {})).resolves.toBe(sentinel);
  });
});

describe("runLLM() custom-provider lane (Codra-style BYOK)", () => {
  const zaiEnv: Partial<Env> = { CF_ACCOUNT_ID: "acct123", CUSTOM_LLM_KEY_ZAI: "zai-key" };

  it("POSTs to the gateway compat URL with the provider key on the request", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const fetchMock = stubFetch(new Response(sse, { headers: { "Content-Type": "text/event-stream" } }));

    const stream = (await runLLM(makeRunEnv("unused", zaiEnv).env, "custom-zai/glm-5.3-flash", {
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    })) as ReadableStream;

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gateway.ai.cloudflare.com/v1/acct123/default/compat/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer zai-key");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "custom-zai/glm-5.3-flash",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    // The stream must parse as the same SSE contract the binding returns.
    await expect(readStreamText(stream)).resolves.toBe("hi");
  });

  it("honors env.AI_GATEWAY in the compat URL", async () => {
    const fetchMock = stubFetch(new Response('{"choices":[{"message":{"content":"ok"}}]}'));

    await runLLM(makeRunEnv("unused", { ...zaiEnv, AI_GATEWAY: "my-gw" }).env, "custom-zai/glm-5.2", {
      messages: [],
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct123/my-gw/compat/chat/completions",
    );
  });

  it("returns parsed JSON when the input is not a stream", async () => {
    const body = { choices: [{ message: { content: "ok" } }] };
    stubFetch(new Response(JSON.stringify(body)));

    await expect(
      runLLM(makeRunEnv("unused", zaiEnv).env, "custom-zai/glm-5.3-flash", { messages: [] }),
    ).resolves.toEqual(body);
  });

  it("rejects with the gateway status and body excerpt on a non-ok response", async () => {
    stubFetch(new Response('{"error":{"code":7003,"message":"Model not found"}}', { status: 404 }));

    await expect(
      runLLM(makeRunEnv("unused", zaiEnv).env, "custom-zai/glm-5.3-flash", { messages: [] }),
    ).rejects.toThrow(/404 .*Model not found/);
  });

  it("rejects naming the missing secret when the provider key is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runLLM(makeRunEnv("unused", { CF_ACCOUNT_ID: "acct123" }).env, "custom-zai/glm-5.3-flash", {
        messages: [],
      }),
    ).rejects.toThrow("CUSTOM_LLM_KEY_ZAI");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when CF_ACCOUNT_ID is not set", async () => {
    stubFetch(new Response("{}"));

    await expect(
      runLLM(makeRunEnv("unused", { CUSTOM_LLM_KEY_ZAI: "zai-key" }).env, "custom-zai/glm-5.3-flash", {
        messages: [],
      }),
    ).rejects.toThrow("CF_ACCOUNT_ID");
  });
});

describe("MODEL_CHOICES", () => {
  for (const key of ["LLM_MODEL", "INSIGHT_LLM_MODEL", "WHEN_LLM_MODEL"] as const) {
    it(`lists ${key} as a non-empty array of non-empty strings including its default`, () => {
      const choices = MODEL_CHOICES[key];

      expect(Array.isArray(choices)).toBe(true);
      expect(choices.length).toBeGreaterThan(0);
      expect(choices.every((choice) => typeof choice === "string" && choice.length > 0)).toBe(true);
      expect(choices).toContain(DEFAULTS[key]);
    });
  }
});
