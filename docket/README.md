# Docket: prices and sale alerts

Every morning (6am Brisbane) this fetches prices for your list from Coles, Woolworths, Aldi and Costco, updates the app, and sends a phone notification when something you're watching goes on special.

## One-off setup (about 20 minutes)

1. **Price source (Apify).** Make an account at apify.com, then copy your API token (Settings, API & Integrations). The scrapers it runs cost about $1 per 1,000 products. A daily run looks up roughly 90 products, so expect a few dollars a month. Check each scraper's Pricing tab.
2. **Phone alerts (ntfy).** Install the free ntfy app. Subscribe to a long random topic name, e.g. `docket-k3x9q7fz2m`. The name works like a password, so keep it private.
3. **GitHub.** Create a new private repo and upload everything in this folder (keep the folder structure, including `.github`).
   - Settings, Secrets and variables, Actions: add secrets `APIFY_TOKEN` and `NTFY_TOPIC`.
   - Settings, Pages: deploy from branch `main`, folder `/docs`. Add the page address as a variable `APP_URL` so tapping an alert opens your app. (Pages on a private repo needs a paid GitHub plan; use a public repo if you don't have one. Nothing in it is secret.)
4. **First run.** Actions tab, "Update prices", Run workflow, tick **discover**. It searches every store and picks the cheapest matching product for each item. Open the run log and read the "Matches" list.
5. Open your Pages link on your phone and add it to your home screen.

After that it runs daily on its own. It only looks up the products it picked, which keeps the cost low.



## Installing it like a normal app

The app is installable. Open your Pages link, then:
- **iPhone:** Safari, Share, Add to Home Screen.
- **Android:** Chrome, menu, Install app (or Add to Home screen).
- **Mac:** Chrome, menu, Save and Share, Install page as app. In Safari, File, Add to Dock.

It then opens in its own window with its own icon and no browser bar. The app and your last prices also load without signal.

If you want it in the App Store or Google Play, that needs paid developer accounts (about US$99 a year for Apple, a one-off US$25 for Google) and a wrapper app. It isn't needed for the above.

## Sharing the list between devices (you and your partner)

Optional, one-off, about 10 minutes. It uses a free Supabase project as a tiny shared notebook.

1. Make a free account at supabase.com and create a project (any name, pick the Sydney region).
2. In the project: SQL Editor, New query, paste the contents of `supabase-setup.sql`, Run.
3. Project Settings, API: copy the **Project URL** and the **public (anon / publishable) key**.
4. Open your app, tap **Sync off** at the top right, paste the URL and key, tap **Make a code**, then **Start syncing**.
5. Tap **Sync**, then **Copy invite link**, and message it to your partner. When she opens it, she's connected. She can then add it to her home screen.

How it behaves:
- Changes show up on the other device within about 15 seconds, or straight away when she opens the app.
- If you both edit at once, both changes are kept. If you both change the same item, the latest change wins.
- It works offline and catches up when you're back online.
- Anyone with the invite link can see and edit the list, so only send it to people you trust. The link contains the code and key, so don't post it publicly.
- Supabase pauses free projects that are unused for a week. Daily use keeps yours active.

## Changing what you track

Edit `catalog.json`:
- `query`: what to search for.
- `include` / `exclude`: words the product name must or must not contain. Use these to fix wrong matches (`"yoghurt|yogurt"` means either word). To compare one brand only, add it to `include`.
- `need`: how much one list item means (2 for 2L of milk).
- `watch: true`: send alerts for this item. Add `"target": 4.50` to also alert when any store drops under that price for your amount.

Then run the workflow again with **discover** ticked.

## Things to know

- **Costco hides some grocery prices from non-members.** Those items show as "not stocked" at Costco. Most non-grocery items show a price.
- **Matching is automatic and imperfect.** It picks the cheapest per kg/L/each among names that pass your filters, so it may choose a home brand over a name brand. Check the Matches list.
- **If a scraper fails or a store blocks it,** that store keeps yesterday's prices and the failure shows in the workflow log.
- The scrapers are community-built and can break when a store changes its site. The actor names are set at the top of `scrape.mjs`; swap one if it stops working.
- Prices are the national online prices, which can differ slightly from your local store.
- **Woolworths pictures** use a guessed image address. If they don't show, the emoji stays. Switching the Woolworths scraper to one that returns images fixes it.

## Testing

`node test.mjs` checks the matching, pricing and alert logic with fake store data. It has not been run against the live stores.
