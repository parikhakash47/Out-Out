# Out Out

Plans the most fun night out from a location, tastes, budget, party size, date and radius.

- `public/index.html` is the app (works in any browser, including phones).
- `api/plan.js` is the server function. It holds your API keys, optionally pulls real venues from Google Places, asks Claude to build the plan, and rate limits each visitor.

## Deploy (about 15 minutes)

1. **Anthropic API key.** Create an account at console.anthropic.com, add billing, create a key. Set a monthly spend limit there.
2. **Optional but recommended: Google Places key.** In Google Cloud, create a project, enable "Places API (New)", create an API key, restrict it to that API, and set a budget alert. Without this key the app still works, but venues come from Claude's general knowledge instead of live data.
3. **Put the project on Vercel.** Either push this folder to a GitHub repo and import it at vercel.com/new, or run `npx vercel` inside this folder.
4. **Add environment variables** in Vercel (Project Settings, Environment Variables):
   - `ANTHROPIC_API_KEY` (required)
   - `GOOGLE_PLACES_API_KEY` (optional)
   - `RATE_LIMIT_PER_HOUR` (optional, default 10 plans per visitor)
   - `MODEL` (optional, default `claude-sonnet-5`)
5. **Redeploy**, open your Vercel URL, and plan a night.
6. **Domain.** Buy one, then add it under Project Settings, Domains.

## Before you share it publicly

- Add a short privacy policy. The app uses the visitor's location and sends it to Anthropic and Google to build plans.
- The rate limit is per server instance and resets on redeploy, so treat it as a basic guard. For stronger limits, add a shared store such as Upstash Redis or Vercel KV.
- Test on real phones (iPhone Safari and Android Chrome).
- Travel times are Claude's estimates. Real ones need the Google Routes API, which is a good next upgrade.

## Run locally

`npm i -g vercel`, then `vercel dev` in this folder, with the environment variables set in a `.env` file.
