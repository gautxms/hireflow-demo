# Backend Auth Service

## Run locally

1. Create PostgreSQL database and enable `pgcrypto`.
2. Run SQL schema:
   ```bash
   psql "$DATABASE_URL" -f backend/sql/schema.sql
   ```
3. Copy env file:
   ```bash
   cp backend/.env.example backend/.env
   ```
4. Start service:
   ```bash
   node backend/src/index.js
   ```

## Deployment (Render / Railway)

Set the following environment variables:
- `DATABASE_URL`
- `JWT_SECRET`
- `FRONTEND_ORIGIN`

Use start command:
```bash
node backend/src/index.js
```

Render/Railway provide HTTPS at the edge; cookies are marked `secure` in production.
