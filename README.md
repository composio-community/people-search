# People Search · Composio Instant

Describe the hire in plain words ("staff ML engineers in SF who've shipped LLM inference") and People Search's AI sourcing agent turns the brief into a shortlist, with a note on why each candidate fits, through [Composio Instant](https://composio.dev/instant): Apollo, Hunter, ContactOut and other paid data providers, billed per call to the signed-in user's Composio wallet with no API keys or subscriptions. You see the exact price of each verified email before you pay for it.

- **Sign in** is the OAuth flow of `connect.composio.dev/mcp` (OAuth 2.1, PKCE, dynamic client registration). The bearer token it returns is what the agent sends to the Composio MCP server, so every Instant call bills the user who signed in.
- **Search is free.** Apollo people search returns titles, companies, first names and masked surnames at $0.
- **Reveal costs cents.** Each person on a shortlist has a Reveal button with its price. Revealing tries providers cheapest-first and stops at the first email: Apollo enrichment unmasks an Apollo surname, then Tomba and Hunter, which bill only when they find one. Bulk reveal, email verification, a saved list and CSV export are on the board.
- **Business development.** Ask which companies are hiring for a role and the agent searches LinkedIn, Indeed, Glassdoor and Google Jobs and shows the postings as cards. "Who's hiring" on any card finds the likely hiring manager and in-house recruiter.
- **Intros.** Ask for a warm intro to a candidate or hiring manager and the agent finds the person, researches recent hooks (LinkedIn and X posts via ScrapeCreators, podcast appearances via Listen Notes, company news via Akta and Context.dev, hiring signals via PredictLeads, papers via OpenAlex), then writes a forwardable intro as a fenced ```` ```intro ```` block in its reply. The block streams token by token and renders live as an email card with sourced hooks, Copy and Open in Gmail.
- **Every call is visible.** The run trace shows each tool call with its provider, arguments, price, duration and raw response, and the header meter tracks spend for the session.

## Run it

```bash
pnpm install
cp .env.example .env.local   # then fill it in, see below
pnpm dev
```

Open the URL `next dev` prints and sign in with Composio. New Composio wallets start with $2 of credit.

### Environment

| Variable | |
|---|---|
| `OPENROUTER_API_KEY` | Required. The agent runs on `AGENT_MODEL` through OpenRouter (AI SDK OpenRouter provider). |
| `AGENT_MODEL` | Defaults to `deepseek/deepseek-v4.1-flash` ($0.14 / $0.42 per M tokens). `minimax/minimax-m3.1-flash`, `z-ai/glm-5.3-flash` and `anthropic/claude-opus-5.5` also work. |
| `SESSION_SECRET` | 32+ random characters; encrypts the session cookie (`openssl rand -base64 48`). |
| `APP_URL` | Optional. Fixes the OAuth redirect origin when running behind a proxy. |

The OAuth client is registered automatically for whatever origin the app runs on, so a different port or domain needs no setup.

## How it works

The chat follows the Composio playground (`ComposioHQ/dashboard`, `src/app/api/playground` and `src/components/core/chat`): Vercel AI SDK v6 `streamText` inside `createUIMessageStream`, sent as the SSE UI message stream, read with `useChat` (50ms throttle), rendered in time order with "Working · 12s" groups that stay open while they run and fold away after, tool chips with live timers, a live reasoning preview, and Streamdown for text. Fast models deliver whole paragraphs in one burst, so the server paces text and reasoning out word by word. Tool outputs are compacted before they reach the browser; full conversations stay on the server.

Reloading picks up where you left off. Each signed-in user's chats (full tool outputs included) and workspace (open chat, revealed contacts, saved list, spend total, spend cap) are saved as JSON under `.data/` (gitignored) by `src/lib/persist.ts`, and the page renders them on load. That's a local store for a demo; on a serverless host, swap it for a database.

Costs are shown at the precision Instant bills in ($0.0015, not $0.002). A Reveal button shows the full range across every provider it may try, from the first one finding the email to the worst case, with the breakdown on hover. The per-request spend cap checks the top of each price range times the number of results a call asks for, so a batch can't exceed it. "Spent" adds up the charges Composio actually reports.


```
browser ──/api/auth/login──▶ connect.composio.dev/oauth/authorize ──▶ /api/auth/callback
   │                                                                      (encrypted httpOnly session)
   ├──/api/chat (AI SDK UI message stream) ──▶ streamText ──▶ model via OpenRouter
   │                                    └──────▶ connect.composio.dev/mcp (Bearer = user token)
   │                                               COMPOSIO_SEARCH_TOOLS / MULTI_EXECUTE_TOOL
   └──/api/reveal ──▶ connect.composio.dev/mcp  (Reveal buttons skip the model entirely)
```

- `src/lib/agent.ts`: `streamText` with three Composio meta tools (wrapped so they never throw and report `durationMs`, charge and found people) Boards are fenced blocks in the reply (```` ```people ````, ```` ```companies ````, and ```` ```intro ```` for drafts), so they stream row by row like the text around them; `src/lib/blocks.ts` parses them, half-written or not. Enforces the per-request spend cap and a research budget, refuses workbench calls, and stops and retries a generation that writes a tool call as text or runs away. The MCP tool list is cached per sign-in, so a follow-up starts the model while the connection opens. Logs per-phase timings as `[agent]` lines.
- `src/app/api/reveal` + `src/lib/reveal-*`: Reveal tries Instant providers one at a time, cheapest first (Tomba, then Hunter, then Apollo; ZeroBounce to verify), stops at the first hit, and streams each attempt to the row.
- `src/lib/entities.ts`: turns any provider payload into people and companies (Apollo ids, masked surnames, Hunter verification, ContactOut profiles keyed by LinkedIn URL).
- `src/components/`: the workspace. `chat-state.ts` derives contacts and spend from the `useChat` messages and lays each message out into groups, text, boards and notices; `timeline.tsx` and `text-segment.tsx` render them.

`pnpm smoke` (and `pnpm smoke:intro` for the intro flow) runs the real agent loop for two turns against the configured model with the MCP server replaced by fictional data. It costs a fraction of a cent and nothing from a Composio wallet.

Design follows [brand.composio.dev](https://brand.composio.dev): Geist and JetBrains Mono only, sans at 400/500, achromatic surfaces with `#51a2ff` as a spot colour for interactive state, and the Instant gradient for hero moments. Light and dark themes both work.
