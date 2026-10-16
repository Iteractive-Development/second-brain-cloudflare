/**
 * runLLM routing and the MODEL_CHOICES picker contract.
 *
 * The router is one `if` with a big blast radius: a @cf model that
 * accidentally gains the gateway option, or a gateway model that loses it,
 * still looks fine in dev and only fails (or double-bills) against real
 * providers. These tests pin the exact call shape per branch. The
 * MODEL_CHOICES checks pin the settings-UI promise: each chat-model list
 * must be non-empty, hold non-empty strings, and include that setting's
 * shipped default, or the picker renders the default as a "Custom" row.
 */
import { describe, it, expect } from "vitest";
import { runLLM } from "../../src/lib/ai";
import { DEFAULTS, MODEL_CHOICES } from "../../src/config";
import type { Env } from "../../src/env";

/** runLLM reads only env.AI and env.AI_GATEWAY, so the double stays this small. */
type FakeAI = { run: (...args: unknown[]) => Promise<unknown> };

/**
 * An env whose AI binding records each run() call, args array included, so
 * arity (two vs three arguments) is observable, and resolves to `result`.
 */
function makeRunEnv(result: unknown = "unused", AI_GATEWAY?: string): { env: Env; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const fakeAI: FakeAI = {
    run: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve(result);
    },
  };
  // Partial double: only the members runLLM reads are present, hence the cast.
  const env = { AI: fakeAI, ...(AI_GATEWAY === undefined ? {} : { AI_GATEWAY }) } as unknown as Env;
  return { env, calls };
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

  it("routes a non-@cf model through AI Gateway id 'default' when env.AI_GATEWAY is unset", async () => {
    const { env, calls } = makeRunEnv();
    const input = { messages: [{ role: "user", content: "hi" }] };

    await runLLM(env, "custom-zai/glm-5.3-flash", input);

    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 2)).toEqual(["custom-zai/glm-5.3-flash", input]);
    expect(calls[0][2]).toEqual({ gateway: { id: "default" } });
  });

  it("uses env.AI_GATEWAY as the gateway id when set", async () => {
    const { env, calls } = makeRunEnv("unused", "my-gw");

    await runLLM(env, "openai/gpt-5.5", { messages: [] });

    expect(calls[0][2]).toEqual({ gateway: { id: "my-gw" } });
  });

  it("resolves to whatever env.AI.run resolves to", async () => {
    const sentinel = { answer: "stream-or-object" };
    const { env } = makeRunEnv(sentinel);

    await expect(runLLM(env, "@cf/openai/gpt-oss-120b", {})).resolves.toBe(sentinel);
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
