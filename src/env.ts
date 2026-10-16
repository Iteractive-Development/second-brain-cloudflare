// Bindings come from the generated Cloudflare.Env (see `wrangler types`);
// VECTORIZE_GRACE_MS, AI_GATEWAY, and CF_ACCOUNT_ID are widened from their
// generated literal defaults so tests and per-deploy vars can override them;
// CUSTOM_LLM_KEY_ZAI is a secret, which `wrangler types` does not emit.
export interface Env extends Omit<Cloudflare.Env, "VECTORIZE_GRACE_MS" | "AI_GATEWAY" | "CF_ACCOUNT_ID"> {
  VECTORIZE_GRACE_MS?: string;
  /** AI Gateway id used by runLLM for non-@cf models; "default" auto-creates on first request. */
  AI_GATEWAY?: string;
  /** Cloudflare account id, used to build the gateway compat URL for custom-provider models. */
  CF_ACCOUNT_ID?: string;
  /** z.ai API key for custom-zai/* models (runLLM's Codra-style BYOK lane). */
  CUSTOM_LLM_KEY_ZAI?: string;
}

// Worker version, echoed by GET /health. The desktop app compares this against
// the version it bundles to offer a one-click "update your Second Brain".
// Bump (semver) when the Worker changes; see installer/README "Worker versioning".
export const SB_VERSION = "4.1.1";
