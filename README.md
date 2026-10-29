# Maa's Stitch & Style

A full-stack storefront for ready-made clothing and custom stitching. The frontend is a Vite static site for Vercel; the Express API and Prisma/PostgreSQL data layer run on Render. Product photos use public object URLs, while customer inspiration images stay private and are delivered only as short-lived administrator-only signed URLs. No owner biography, portrait, address, customer details, testimonials, or product claims are invented.

## Project layout

- `client/` — React, TypeScript, Vite and responsive boutique interface.
- `server/` — Express API, validation, sessions, uploads and Prisma client.
- `server/prisma/schema.prisma` and `server/prisma/migrations/` — PostgreSQL data model and checked-in migrations.
- `render.yaml` — Render API service and PostgreSQL blueprint.
- `vercel.json` — Vercel frontend build configuration.

## Local development

Requirements: Node.js 20.19–24, pnpm 11.25.0 (Corepack can activate the version declared in `package.json`), PostgreSQL 14+, and an S3-compatible bucket for testing image uploads.

1. Copy `.env.example` to `server/.env` and set local PostgreSQL details plus a random session secret. This path is important: the server and Prisma run from the `server/` workspace. `client/.env.local` may contain `VITE_API_URL=` (blank uses Vite's `/api` development proxy).
2. Install and initialize:

   ```sh
   corepack pnpm install --frozen-lockfile
   corepack pnpm db:generate
   corepack pnpm db:migrate
   ```

3. Start the frontend and API with `corepack pnpm dev`. Open `http://localhost:5173`; the API health check is `http://localhost:4000/api/health`.
4. To create the owner login locally, set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters in `server/.env`, then run `corepack pnpm db:seed`. Seed hashes the password with bcrypt and does not overwrite an existing owner password. Do not commit either env file.
5. Demo catalogue rows are not created by default. If you intentionally enable `SEED_DEMO=true` for a one-time seed, examples are clearly labeled, inactive, and have zero stock. Replace them with owner-supplied product details, prices, and images before activation.

## Environment variables

### Vercel frontend

- `VITE_API_URL` — the public origin of the deployed Render API, without a trailing slash or `/api` (for example, the actual Render service origin after it is created). It is embedded in the public frontend bundle and must never contain secrets.

### Render API

- `DATABASE_URL` — supplied by the attached Render PostgreSQL database; server-only.
- `CLIENT_ORIGINS` — comma-separated exact origins that may call the API, including scheme and any Vercel preview/production domains you choose to support. Do not use `*`. Obtain the actual Vercel URL from your deployment; it is intentionally not prefilled here. Until set, browser CORS requests are denied.
- `SESSION_SECRET` — long random secret (Render can generate it); at least 32 characters in production.
- `BUSINESS_WHATSAPP_NUMBER` — international digits only, including country code, without `+` (for example `91...`); may be replaced through Business Settings.
- `BUSINESS_PHONE`, `BUSINESS_EMAIL` — optional public contact defaults.
- `S3_ENDPOINT`, `S3_REGION`, `S3_REFERENCE_BUCKET`, `S3_PRODUCT_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — object storage endpoint, separate private/public buckets, and server-only credentials. Keep secret access keys only on the server.
- `S3_PUBLIC_BASE_URL` — public base URL/CDN for product images only. The bucket's customer-reference prefix must not be publicly readable.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` — one-time owner bootstrap inputs used by `pnpm db:seed`. Add them as protected Render environment variables only for account setup, run the seed once, then remove `ADMIN_PASSWORD` from the service environment. Password changes for an existing owner must be done through an explicit secure password-management procedure; the seed intentionally does not overwrite existing hashes.
- `NODE_ENV=production`, `PORT` (Render provides this), and `SEED_DEMO=false`.

Local server-only settings are shown in `.env.example`. `COOKIE_SECURE` is only for local testing; production always uses HTTPS-only, `SameSite=None`, HttpOnly cookies for the separate Vercel/Render origins.

## Object storage setup

Configure an S3-compatible provider (for example, Cloudflare R2 or AWS S3) separately from Render. Create two separate buckets: one private reference-image bucket and one public product-image bucket. Set `S3_REFERENCE_BUCKET` and `S3_PRODUCT_BUCKET` accordingly, generate a least-privilege access key for the server, and configure a public product-image base URL/CDN for the product bucket. Never expose the reference bucket through a public domain or bucket policy. The API checks image bytes (JPEG/PNG/WebP), limits each file to 5 MB and product uploads to six files per request, generates random keys, and encrypts uploads at rest where supported. Customer reference images are accessed through five-minute signed links after admin authentication. Verify provider CORS if administrators use the provider's public image upload URLs; uploads themselves go from the browser to the API.

## Database and owner account

The Render blueprint links the web service to a Render PostgreSQL database. The API uses `DATABASE_URL` on the server; no database URL is sent to Vercel. Migrations are checked into `server/prisma/migrations/` and the blueprint runs `pnpm db:migrate` as a pre-deploy step. For manual setup or recovery, run `pnpm db:generate` and then `pnpm db:migrate` from the repository root with the server's `DATABASE_URL` available.

To create the first owner: add `ADMIN_EMAIL` and a newly generated unique `ADMIN_PASSWORD` as protected Render environment variables, open the Render service Shell, run `pnpm db:seed`, verify owner login through the storefront `Owner sign in` link (`/#/admin`), then delete the temporary `ADMIN_PASSWORD` variable. The app has no public registration or default credentials. Confirm the bootstrap password is not saved in build logs or committed files.

## Deploy to Vercel and Render

1. Push this repository to a Git provider. In Render, create a Blueprint from the repository's `render.yaml`. Review the selected plans and charges; this blueprint provisions a paid Render web service and PostgreSQL instance. Render does not create the separate S3-compatible image store.
2. In Render, configure the API's server-only storage/contact variables. `CLIENT_ORIGINS` can initially remain blank; the API remains up but browsers will not be allowed through CORS until the real Vercel origin is entered. Complete the first Render deploy and verify `https://<your-render-service>/api/health` returns `{"status":"ok"}`.
3. In Vercel, import the same repository. Use the repository root as the project root (do not set `client` as Root Directory because the pnpm workspace lockfile is at the root). `vercel.json` defines the frontend build and static output. Set `VITE_API_URL` to the actual Render service origin, then deploy the frontend. Vite's hash routing supports direct page visits without server rewrites.
4. Copy the actual Vercel production origin, including `https://`, into Render's `CLIENT_ORIGINS`. Add only the preview origins you deliberately want to authorize. Redeploy/restart the Render API after changing it.
5. Follow the owner-account procedure above. Configure the business WhatsApp number, business contact information, coverage areas, and pickup/delivery wording in Owner Studio. Upload real products and photos, verify sizes and stock, then activate each item.
6. Before public launch, test the customer and owner flows below and check the Vercel production build uses the correct API origin.

### Commands

```sh
# local installation and checks
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build

# one-time owner initialization (with server DATABASE_URL and temporary ADMIN_EMAIL/ADMIN_PASSWORD set)
corepack pnpm db:seed
```

Never run a migration against production until the Render database has been provisioned and its `DATABASE_URL` confirmed. Take/verify a backup before destructive schema changes.

## Deployment checklist

- [ ] Render PostgreSQL provisioned and backup/retention options reviewed.
- [ ] Render API health check returns 200 after migrations.
- [ ] Exact Vercel origin(s) configured in Render `CLIENT_ORIGINS` (no wildcard).
- [ ] Vercel `VITE_API_URL` points to the correct Render API origin.
- [ ] `SESSION_SECRET` generated and at least 32 characters; production cookies are secure.
- [ ] S3 product photos publicly retrievable from the configured product base URL.
- [ ] Reference-image prefix is private; admin signed links expire and are not shared publicly.
- [ ] Temporary owner bootstrap password removed from Render after seeding.
- [ ] WhatsApp and contact data configured by the owner.
- [ ] Demo products remain inactive; only genuine products with owner-supplied photos/details are activated.
- [ ] Customer order and stitching submissions appear in PostgreSQL-backed Owner Studio.

## Troubleshooting

- **Browser says CORS blocked:** set the exact Vercel origin, including `https://` and no path, in Render `CLIENT_ORIGINS`; allowlist every intended Vercel domain explicitly. Keep `credentials: include` and do not use a wildcard.
- **Owner login succeeds but admin pages return 401:** confirm client `VITE_API_URL`, Render CORS origin, HTTPS, and cross-site cookies. The browser must accept secure third-party cookies; for stricter browser privacy, use custom frontend/API hostnames under the same registrable domain when possible.
- **API health returns 503:** check Render logs, database availability and server-only `DATABASE_URL`; verify the migration pre-deploy step completed.
- **Product image upload fails:** confirm S3 endpoint, bucket, key permissions, `S3_PUBLIC_BASE_URL`, and bucket/CDN access for the `products/` prefix.
- **Custom reference upload fails:** confirm private bucket credentials and S3 write permissions; reference objects must remain private.
- **No products appear:** only active products are public. Add genuine items and activate them in Owner Studio.
- **WhatsApp link has no useful number:** set the business WhatsApp number in Owner Studio or `BUSINESS_WHATSAPP_NUMBER` using the international country code.

## Verification and limitations

`pnpm test` currently covers ready-made order rule cases. PostgreSQL-backed endpoint flows and S3 upload access require real services; local build/test checks do not prove those external integrations or a live deployment. No deployment is claimed by this repository configuration alone.
