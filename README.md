# R TEX BD — Premium Three-Piece Store

Production-oriented Node.js + Express + EJS + Turso/libSQL e-commerce website for R TEX BD.

## Included
- Screenshot-matched premium R TEX BD storefront design.
- Dynamic categories, products, variants, stock, cart and checkout/order flow.
- 8 first-run demo categories, products, variants and approved reviews so the store is not empty.
- Admin login, dashboard, products, orders, settings and review management.
- Review fields: customer name, phone model, rating and review; admin can publish/hide reviews.
- Public reviews automatically side-scroll on the homepage.
- Natural shopping assistant with Bangla/Banglish/English support.
- Fully coded human-style shopping assistant: Bangla/Banglish/English intent handling, budget/size/color extraction, live catalog search, recommendations, delivery/order/policy guidance, and order-number lookup.
- Turso legacy-schema upgrade checks for common missing columns before indexes are created.
- Security basics: Helmet, rate limits, signed HTTP-only cookie session, validation and protected admin APIs.

## Render environment variables
Set these in Render -> Environment:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `SESSION_SECRET` (long random value)
- `ADMIN_USERNAME` (for example `admin`)
- `ADMIN_PASSWORD` (strong password) OR `ADMIN_PASSWORD_HASH`
- `NODE_ENV=production`

If `ADMIN_PASSWORD` is present, the server hashes it at startup. Never commit real secrets to GitHub.

## Admin
Open `/admin/login` and use the username/password configured in Render Environment Variables. The login creates a signed HTTP-only session and redirects to `/admin`.

## Turso
The app creates missing tables and upgrades common legacy columns. It does not intentionally drop existing data. If a legacy table has an incompatible structure that cannot be safely inferred, inspect that table before performing a manual migration rather than deleting production data.

## Product images
Built-in visual assets are under `public/assets`. Admin-uploaded product images are written to `UPLOAD_DIR` (default `./uploads`). On Render, use a persistent disk for uploads or replace the upload storage with an object-storage adapter before relying on uploads across redeploys.

## Chatbot
The assistant is implemented directly in `server.js` as a database-grounded conversational decision engine. It does not require an external AI API: it normalizes Bangla/Banglish/English, detects intents, remembers recent preferences from chat history, extracts budgets/sizes/colors, ranks the live catalog, answers delivery/order/return/contact questions, and can look up an order by order number. It never invents product, price, stock or order data.

## Local run
```bash
npm install
cp .env.example .env
npm start
```


## Deployment preflight
`npm start` automatically runs `npm run prestart` first. The preflight verifies the complete `views/`, `public/assets/`, server, schema and package structure before the web server starts. This prevents a partial GitHub upload (for example, a missing `views/home.ejs`) from silently deploying a broken storefront.

## Render
Use the repository root as the Render service root. Build command: `npm install`. Start command: `npm start`. Health check: `/health`. Upload the **entire repository contents**, including `views/` and `public/assets/`; do not upload only `server.js`.
