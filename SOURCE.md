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

No other files differ from upstream `main`. Take upstream updates by merging
`upstream/main` and resolving `wrangler.jsonc` to keep the pinned IDs.
Do not run updates from the Second Brain desktop app once the Git lane is
connected; an installer update deploys over the repo's build. `AUTH_TOKEN` is
a Worker secret and is not stored in this repository.
