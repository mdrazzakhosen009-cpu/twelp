# R TEX BD — Premium Three-Piece Store

A responsive, real-world women’s three-piece e-commerce store based on the supplied R TEX BD reference design.

## Included
- Reference-matched premium storefront: dark top bar, circular R TEX BD logo, search, WhatsApp header, black navigation, fashion hero, circular categories, featured product cards, promotional banners, review carousel and bottom service bar.
- Eight first-run demo categories and eight demo products with local visual assets so the homepage is not empty.
- Product pages with live size/color/stock selection and cart.
- Checkout with server-side stock validation and order numbers.
- Admin dashboard, product/category management, order management, settings and review management.
- Admin can create reviews with customer name, phone model, rating and text, and publish/hide them.
- Approved reviews automatically side-scroll on the homepage and appear on the Reviews page.
- Customer review submissions remain pending until admin approval.
- Human-like shopping assistant: Bangla/Banglish/English support, product discovery, budget guidance, size/color/stock, delivery, ordering, return and contact questions. If `GEMINI_API_KEY` is configured, the assistant uses Gemini with store/product context; without it, a broader deterministic fallback remains available.
- Secure server-side admin session, rate limiting, validation and legacy Turso schema upgrade handling.

## Environment
Set these in Render or `.env`:
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `SESSION_SECRET` — use a long random secret
- `ADMIN_USERNAME` — default `admin`
- `ADMIN_PASSWORD` — your admin password; the server hashes it at startup when a hash is not supplied
- `ADMIN_PASSWORD_HASH` — optional alternative to `ADMIN_PASSWORD`
- `GEMINI_API_KEY` — optional, enables the generative human-like assistant
- `GEMINI_MODEL` — optional, default `gemini-2.5-flash`
- `NODE_ENV=production`
- `PORT` — Render supplies this automatically
- `UPLOAD_DIR` — defaults to `./uploads`

## Local
```bash
npm install
cp .env.example .env
npm start
```

The server creates missing tables and indexes and also upgrades older Turso tables when safe. In particular, an older `variants` table without `product_id` is upgraded before the product index is created, preventing the previous startup crash.

## Render
Build: `npm install`
Start: `npm start`

Configure the environment variables above. For uploaded product images, use a persistent Render disk and set `UPLOAD_DIR` to its mounted directory; otherwise local uploads can disappear after a redeploy/replacement.

## Admin
Open `/admin/login`. The login is a signed server-side session. After successful login the user is redirected to `/admin`; all admin APIs are protected server-side and cannot be unlocked by changing frontend code.

## Notes
- Product images are stored as files and only their URLs are stored in Turso.
- Default WhatsApp number: `01629380347` / `8801629380347`.
- The checkout currently records unpaid/COD-style orders; a real payment gateway should be added only after the provider and merchant credentials are supplied.
