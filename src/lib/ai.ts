import type { Env } from "../env";
import { DEFAULTS, type Config } from "../config";
import { EMBEDDING_MODEL } from "../constants";

export function graceMs(env: Env): number {
  return parseInt(env.VECTORIZE_GRACE_MS ?? "300000", 10) || 300000;
}

/**
 * One entry point for every chat-style LLM call. `@cf/` models run on
 * Workers AI directly. Native third-party models (`openai/gpt-5.5`, …) go
 * through the gateway via the Workers AI binding. `custom-*` models (account
 * custom providers, e.g. `custom-zai/glm-5.3-flash`) cannot use the binding:
 * it 404s on them, and the gateway's Secrets-Store BYOK never substitutes a
 * key for a custom provider (both checked live, 2026-10-16). So they use the
 * Codra technique instead: this Worker holds the provider key itself and puts
 * it on the request, calling the gateway's OpenAI-compat endpoint — the
 * gateway still fronts the call for logging and caching, but the credential
 * travels app-side, exactly like Codra's worker decrypts and attaches its
 * provider keys.
 *
 * The gateway named by env.AI_GATEWAY (default "default") auto-creates on the
 * first authenticated request.
 *
 * Embeddings and the reranker deliberately do NOT go through here: they stay
 * on Workers AI `@cf/` models — the Vectorize index is 384-dim
 * bge-small-en-v1.5 and the cross-encoder has no gateway equivalent.
 */
export function runLLM(env: Env, model: string, input: Record<string, unknown>): Promise<unknown> {
  // The binding's run() overloads are any-typed by workers-types; passing
  // string/Record keeps this side of the boundary checked.
  if (model.startsWith("@cf/")) return env.AI.run(model, input);
  if (model.startsWith("custom-")) return runCustomProviderLLM(env, model, input);
  return env.AI.run(model, input, { gateway: { id: env.AI_GATEWAY ?? "default" } });
}

/** custom-<slug>/<model>: which Worker secret holds that provider's API key. */
function customProviderKey(env: Env, slug: string): string | undefined {
  if (slug === "zai") return env.CUSTOM_LLM_KEY_ZAI;
  return undefined;
}

/**
 * The Codra-style BYOK lane described on runLLM. Requests go to the gateway's
 * compat endpoint (`/compat/chat/completions`), which routes by the
 * `custom-<slug>/` model prefix to the provider's base_url. With
 * `stream: true` the SSE body is returned as a ReadableStream — the same
 * contract the binding returns, so every existing caller (readStreamText,
 * POST /chat's raw passthrough) works unchanged; the deltas are
 * OpenAI-shaped, which extractChunkText and its recall.js twin already parse.
 */
async function runCustomProviderLLM(env: Env, model: string, input: Record<string, unknown>): Promise<unknown> {
  const slug = /^custom-([a-z0-9-]+)\//.exec(model)?.[1];
  const key = slug ? customProviderKey(env, slug) : undefined;
  if (!slug || !key) {
    throw new Error(`No provider key configured for model "${model}" — set the CUSTOM_LLM_KEY_${(slug ?? "??").toUpperCase().replace(/-/g, "_")} secret.`);
  }
  if (!env.CF_ACCOUNT_ID) throw new Error("CF_ACCOUNT_ID var is required for custom-provider models.");

  const gateway = env.AI_GATEWAY ?? "default";
  const url = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${gateway}/compat/chat/completions`;
  // The binding injects the model into the request itself; the compat
  // endpoint expects it in the body, and its router keys off the
  // `custom-<slug>/` prefix to pick the provider.
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, model }),
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    throw new Error(`AI Gateway custom-provider call failed: ${resp.status} ${detail}`);
  }
  if (input.stream) {
    if (!resp.body) throw new Error("AI Gateway custom-provider stream returned no body.");
    return resp.body;
  }
  return resp.json();
}

/**
 * Workers AI streams two different answer shapes depending on model lineage.
 * Llama-family models (the shipped default) put the text directly on
 * `response`. OpenAI-lineage models (`@cf/openai/gpt-oss-*`) stream an
 * OpenAI-style chat-completion delta instead, under `choices[0].delta.content`
 * — and the reasoning ones in that family emit chain-of-thought first, as
 * `delta.reasoning` / `delta.reasoning_content`, before any `delta.content`.
 * That chain-of-thought is deliberately never returned here: every caller of
 * `readStreamText` treats the result as the answer — JSON.parse'ing it or
 * feeding it straight into a digest — not as reasoning prose.
 *
 * POST /chat (src/routes/recall.ts) is the one caller that does NOT go
 * through `readStreamText` — it streams the raw Workers AI response
 * straight to the browser, so public/js/recall.js hand-mirrors this exact
 * function (extractChatChunkText) and the buffering below it. Keep the two
 * in sync: a change here is a prompt to check there, and vice versa.
 */
function extractChunkText(d: any): string {
  if (d?.response) return d.response;
  const content = d?.choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
}

function consumeSseLine(line: string, onText: (chunk: string) => void): void {
  if (!line.startsWith("data:")) return;
  // SSE permits exactly one optional space after the field colon.
  const payload = line.slice(line.startsWith("data: ") ? 6 : 5);
  // The completion sentinel is the WHOLE payload, never a substring of one —
  // an answer may legitimately contain the text "[DONE]". trimEnd() tolerates
  // the trailing \r a CRLF stream leaves after splitting on \n.
  if (payload.trimEnd() === "[DONE]") return;
  try {
    const d = JSON.parse(payload);
    const text = extractChunkText(d);
    if (text) onText(text);
  } catch (e) {
    // A parse failure here is on a COMPLETE line (buffering already held back
    // any partial one), so it's a genuine anomaly rather than a chunk-boundary
    // artifact — worth a log, but it must not interrupt the stream: dropping
    // one malformed SSE line is far better than losing everything read so far.
    console.error("readStreamText: malformed SSE line (non-fatal):", e);
  }
}

export async function readStreamText(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // { stream: true } holds back a trailing partial multi-byte sequence
    // until the bytes that complete it arrive in the next chunk.
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // The last element is either "" (buffer ended on a newline) or an
    // incomplete line — either way it isn't a complete line yet, so it stays
    // buffered for the next read rather than being parsed now.
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeSseLine(line, chunk => { text += chunk; });
  }
  // Flush any bytes the decoder was holding back for a not-yet-complete
  // multi-byte character.
  buffer += decoder.decode();
  reader.releaseLock();
  // The stream may end without a trailing newline after its last line —
  // process whatever is left in the buffer rather than dropping it.
  if (buffer) consumeSseLine(buffer, chunk => { text += chunk; });
  return text;
}

export async function embed(
  text: string,
  env: Env,
  config: Readonly<Config> = DEFAULTS,
): Promise<number[]> {
  const [vector] = await embedMany([text], env, config);
  return vector;
}

/** Texts per embedding call. The bge-*-en-v1.5 schemas allow 100 (maxItems, Workers AI docs,
 * checked 2026-09-27); bge-m3 documents no limit, so it gets a conservative 25. */
export function embedBatchSize(model: string): number {
  return /^@cf\/baai\/bge-(small|base|large)-en-v1\.5$/.test(model) ? 100 : 25;
}

/**
 * Embeds every text in `texts`, in order, embedBatchSize(model) per AI call: one call for the few texts
 * standing memory (Track 7) and the single-text wrapper pass, a handful for a long note's chunks (T-0089.1.1). bge-m3
 * gets truncate_inputs (it rejects over-length input otherwise; the bge-en models reject the field; #326
 * spec, 10.6). Throws if a call returns a count that does not match its batch, so a caller never pairs a
 * vector with the wrong text.
 */
export async function embedMany(texts: readonly string[], env: Env, config: Readonly<Config> = DEFAULTS): Promise<number[][]> {
  const size = embedBatchSize(config.EMBEDDING_MODEL);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += size) {
    const batch = texts.slice(i, i + size);
    const input = config.EMBEDDING_MODEL === "@cf/baai/bge-m3" ? { text: batch, truncate_inputs: true } : { text: batch };
    // Workers AI requires `as any` here — the SDK types don't cover all models
    const result = (await env.AI.run(config.EMBEDDING_MODEL as any, input as any)) as any;
    const data = result?.data as number[][] | undefined;
    if (!Array.isArray(data) || data.length !== batch.length) throw new Error(`embedMany: expected ${batch.length} vectors, got ${data?.length ?? 0}`);
    out.push(...data);
  }
  return out;
}
