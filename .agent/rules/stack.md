---
trigger: always_on
---

# Tech Stack & Tools

- **Runtime & PM:** Bun
- **Hosting:** Cloudflare Pages (SPA mode)
- **Language:** TypeScript
- **Framework:** SvelteKit (Svelte 5 Runes)
- **UI Library:** shadcn-svelte
- **Styling:** Tailwind CSS v4
- **State Management:** Nanostores (w/ `@nanostores/persistent`)
- **Icons/Fonts:** `@lucide/svelte`, Inter font
- **Server Framework:** Hono
- **Compute:** Cloudflare Durable Objects
- **ORM:** Drizzle ORM
- **Relational DB:** Cloudflare D1 (Global) & Durable Object SQLite (Consistency)
- **Key-Value:** Cloudflare KV
- **Object Storage:** Cloudflare R2
- **Auth Provider:** BetterAuth
- **Protection:** Cloudflare Turnstile, WAF, Rate Limiting
- **Validation:** Valibot
- **Real-time:** WebSockets (Hibernation API on Durable Objects, Nanostores on client)
- **Testing:** Vitest (w/ `@cloudflare/vitest-pool-workers`)
