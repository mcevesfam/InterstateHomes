# Interstate Homes — Infrastructure Setup, Deployment & Turnover Runbook

Covers SOW Sections 10, 12, and 14 (independent deployment from Git, US data residency, and backup/restore verification).

## 1. Primary Cloud Deployment: Google Cloud Run (`us-west1`, Staging + Production)

Full step-by-step instructions and the dry-run provisioning script live in [infra/gcp/README.md](./gcp/README.md) and [infra/gcp/provision-env.ps1](./gcp/provision-env.ps1).

### Infrastructure Checklist (Interstate Homes Accounts)
1. **Google Cloud Project (`us-west1`):**
   - Artifact Registry Docker repository (`interstate-homes`)
   - Private GCS buckets (`<PROJECT_ID>-interstate-docs-staging` and `<PROJECT_ID>-interstate-docs-prod`) with uniform bucket-level access and public access prevention enforced
   - Dedicated least-privilege runtime Service Accounts (`interstate-api-<env>`, `interstate-web-<env>`) using Workload Identity (zero static keys; V4 signed URLs via `roles/iam.serviceAccountTokenCreator` + `roles/storage.objectAdmin`)
   - Secret Manager secrets (`interstate-<env>-database-url`, `interstate-<env>-app-encryption-key`, `interstate-<env>-session-secret`, `interstate-<env>-docuseal-api-key`, `interstate-<env>-resend-api-key`) replicated in `us-west1`
2. **Database (Neon Postgres, US Region):** Create `interstate-staging` and `interstate-prod` branches in a US region (e.g. `aws-us-west-2`). Store pooled `DATABASE_URL` connection strings in Secret Manager.
3. **Outbound Email:** Verify `interstatehomes.com` SPF/DKIM/DMARC records in Resend or Postmark (`EMAIL_FROM=estimating@interstatehomes.com`).
4. **CI/CD (`cloudbuild.yaml`):**
   - Push to `staging` triggers Staging build -> pushes `api` & `web` images -> runs Cloud Run Migration Job (`interstate-migrate-staging`, `node apps/api/dist/db/migrate.js && node apps/api/dist/db/seed.js`) with `--wait` -> deploys `interstate-api-staging` -> deploys `interstate-web-staging` with `API_INTERNAL_URL` pointing to the API service URL.
   - Push to `main` runs the identical pipeline against Production (`_ENV=prod`).

### Cloud Run Rollback Procedure
Route traffic back to a previous healthy revision in Cloud Run Console or via `gcloud run services update-traffic`, or re-run Cloud Build against a prior Git tag/commit SHA.

---

## 2. Self-Hosted Docker Compose Deployment (Alternative / Local Verification)

```bash
git clone https://github.com/mcevesfam/InterstateHomes.git interstate-homes
cd interstate-homes
cp .env.example .env
# Populate DATABASE_URL, APP_ENCRYPTION_KEY, SESSION_SECRET, S3_* (or GCS_BUCKET), DOCUSEAL_API_KEY
docker compose -f infra/docker-compose.yml up -d --build
```

Apply database migrations and seed the 81 cost codes (uses the compiled image directly):

```bash
docker compose -f infra/docker-compose.yml exec api sh -c "node apps/api/dist/db/migrate.js && node apps/api/dist/db/seed.js"
```

### Self-Hosted Rollback Procedure

```bash
git checkout <PREVIOUS_TAG_OR_COMMIT>
docker compose -f infra/docker-compose.yml up -d --build
```

---

## 3. Database Backup & Restore Verification (Section 14 Turnover Test)

1. Enable Neon Point-in-Time Recovery (PITR) or run `pg_dump "$DATABASE_URL" -Fc -f backup.dump`.
2. Create a clean test branch/database and restore: `pg_restore --clean --no-owner -d "$TEST_DATABASE_URL" backup.dump`.
3. Run `node apps/api/dist/db/migrate.js` (or `npm run db:migrate --workspace=@interstate/api`) against the restored database and verify `GET /api/cost-codes` returns 81 codes and `job_cost_budgets` row counts match.

---

## 4. Key & Secret Rotation

- **Cloud Run / Secret Manager:** Add a new secret version via `gcloud secrets versions add interstate-<env>-<secret> --data-file=<path> --project=<PROJECT_ID> --quiet` and redeploy the Cloud Run service to pick up `:latest`.
- **Session Secret:** Rotating `SESSION_SECRET` invalidates active sessions cleanly.
- **Storage Credentials:** On GCP Cloud Run with `GCS_BUCKET`, Workload Identity issues short-lived tokens automatically (no static storage keys to rotate). For S3/R2 deployments, rotate `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` and redeploy.
- **Encryption Key:** Rotating `APP_ENCRYPTION_KEY` requires running a re-encryption script over `compliance_documents.w9_tin_encrypted` and `users.mfa_secret_encrypted`.
