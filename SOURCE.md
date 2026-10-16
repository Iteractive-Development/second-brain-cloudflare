# Source and maintenance

Fork of `rahilp/second-brain-cloudflare`, deployed as the Worker `second-brain`
in the Iteractive Development Cloudflare account
(`second-brain.iteractive.workers.dev`). First provisioned 2026-10-16 by the
Second Brain desktop installer (4.0.1); the Git deploy lane replaced the
installer lane afterwards.

Local changes to upstream:

- `wrangler.jsonc` pins this account's resource IDs: `account_id`, the D1
  `database_id` for `second-brain-db`, and the KV namespace `id` for
  `second-brain-oauth`. Upstream leaves these unset so self-hosters' deploys
  provision their own resources; without the pin, a CI deploy would create a
  new KV namespace and Vectorize-adjacent drift instead of binding the
  existing ones.
- `wrangler.jsonc` adds the custom domain route `brain.iteractive.dev`
  (workers.dev stays enabled) and the `AI_GATEWAY` var ("default").
- External LLM support (4.1.0): `src/lib/ai.ts` `runLLM` routes every
  chat-style call — `@cf/` models straight to Workers AI, any
  `provider/model` string (e.g. `openai/gpt-5.5`, `custom-zai/glm-5.3-flash`)
  through AI Gateway (Unified Billing or a BYOK key under the `default`
  alias). All eight call sites use it. `src/config.ts` `MODEL_CHOICES` +
  `modelChoices` on GET `/config` feed three model pickers in the dashboard
  settings sheet (`public/index.html`, `public/js/settings-panel.js`,
  `public/js/i18n.js`). `custom-zai/*` names the account's AI Gateway custom
  provider "zai" (base_url `https://api.z.ai`, path `/api/paas/v4/...`),
  carrying the GLM Coding Plan key. Embeddings and the reranker stay on
  `@cf/` models by design.

No other files differ from upstream `main`. Take upstream updates by merging
`upstream/main` and resolving `wrangler.jsonc` to keep the pinned IDs and the
route/var additions, and expect merge conflicts wherever upstream touches the
eight `runLLM` call sites or the settings sheet. Do not run updates from the
Second Brain desktop app once the Git lane is connected; an installer update
deploys over the repo's build. `AUTH_TOKEN` is a Worker secret and is not
stored in this repository.
