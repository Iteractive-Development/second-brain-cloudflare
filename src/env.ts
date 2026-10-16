// Bindings come from the generated Cloudflare.Env (see `wrangler types`);
// VECTORIZE_GRACE_MS and AI_GATEWAY are widened from their generated literal
// defaults so tests and per-deploy vars can override them.
export interface Env extends Omit<Cloudflare.Env, "VECTORIZE_GRACE_MS" | "AI_GATEWAY"> {
  VECTORIZE_GRACE_MS?: string;
  /** AI Gateway id used by runLLM for non-@cf models; "default" auto-creates on first request. */
  AI_GATEWAY?: string;
}

// Worker version, echoed by GET /health. The desktop app compares this against
// the version it bundles to offer a one-click "update your Second Brain".
// Bump (semver) when the Worker changes; see installer/README "Worker versioning".
export const SB_VERSION = "4.1.0";
