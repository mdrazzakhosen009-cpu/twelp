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
- Optional Gemini-powered conversational mode with recent conversation history and live catalog context.
- Turso legacy-schema upgrade checks for common missing columns before indexes are created.
- Security basics: Helmet, rate limits, signed HTTP-only cookie session, validation and protected admin APIs.

## Render environment variables
Set these in Render -> Environment:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `SESSION_SECRET` (long random value)
- `ADMIN_USERNAME` (for example `admin`)
- `ADMIN_PASSWORD` (strong password) OR `ADMIN_PASSWORD_HASH`
- `GEMINI_API_KEY` for full natural-language AI chat
- `GEMINI_MODEL` optional; defaults to `gemini-2.5-flash`
- `NODE_ENV=production`

If `ADMIN_PASSWORD` is present, the server hashes it at startup. Never commit real secrets to GitHub.

## Admin
Open `/admin/login` and use the username/password configured in Render Environment Variables. The login creates a signed HTTP-only session and redirects to `/admin`.

## Turso
The app creates missing tables and upgrades common legacy columns. It does not intentionally drop existing data. If a legacy table has an incompatible structure that cannot be safely inferred, inspect that table before performing a manual migration rather than deleting production data.

## Product images
Built-in visual assets are under `public/assets`. Admin-uploaded product images are written to `UPLOAD_DIR` (default `./uploads`). On Render, use a persistent disk for uploads or replace the upload storage with an object-storage adapter before relying on uploads across redeploys.

## Chatbot
Without `GEMINI_API_KEY`, the assistant uses a store-aware fallback. With Gemini configured, it maintains recent conversation history from the browser, understands Bangla/Banglish/English and uses the current catalog/settings as grounding. It is intentionally instructed not to invent stock, prices, policies or order status.

## Local run
```bash
npm install
cp .env.example .env
npm start
```
