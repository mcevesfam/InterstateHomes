# Interstate Homes — Google Cloud Run Deployment Guide (Staging & Production)

This guide covers deploying Interstate Homes (`apps/api`, `apps/web`, and the Drizzle migration/seed job) to **Google Cloud Run** in **`us-west1`** (US data residency, SOW Sections 10 & 12) with private **Google Cloud Storage (GCS)** signed URLs (Workload Identity / zero static keys), **Secret Manager**, **Artifact Registry**, and **Cloud Build** GitHub triggers.

> [!IMPORTANT]
> All `gcloud` commands below and in `provision-env.ps1` have been leaf-syntax validated against **Google Cloud SDK 594.0.1** (`gcloud help <leaf_command>`).
> Destructive operations, API enablement, billing changes, and IAM policy modifications are **never executed autonomously** — always review the dry-run output and explicitly authorize execution against your confirmed `<PROJECT_ID>`.

---

## Architecture Overview

| Component | Staging (`staging` branch) | Production (`main` branch) | Region |
|---|---|---|---|
| Web Service (Next.js 15 + `/api/*` proxy) | `interstate-web-staging` | `interstate-web-prod` | `us-west1` |
| API Service (Fastify + Drizzle + GCS) | `interstate-api-staging` | `interstate-api-prod` | `us-west1` |
| Migration & Seed Job | `interstate-migrate-staging` | `interstate-migrate-prod` | `us-west1` |
| Private Document Bucket (GCS) | `<PROJECT_ID>-interstate-docs-staging` | `<PROJECT_ID>-interstate-docs-prod` | `us-west1` |
| Artifact Registry Repo | `interstate-homes` | `interstate-homes` | `us-west1` |
| Database (Neon Postgres US) | `interstate-staging` branch | `interstate-prod` branch | US (`aws-us-west-2`) |

### Security & Zero-Static-Keys Design
- **GCS Signed URLs (`apps/api/src/services/storage.ts`)**: When `GCS_BUCKET` is set, the API uses `@google-cloud/storage` with Cloud Run's attached Workload Identity service account (`interstate-api-<env>@<PROJECT_ID>.iam.gserviceaccount.com`) to mint 5-minute V4 expiring upload/download URLs via IAM `signBlob` (`roles/iam.serviceAccountTokenCreator` on itself + `roles/storage.objectAdmin` on its bucket). **Zero static JSON keys or S3 access keys are stored.**
- **Private Buckets**: Created with `--uniform-bucket-level-access` and `--public-access-prevention`.
- **Runtime API Proxy**: `apps/web` listens on `0.0.0.0:$PORT` (`8080` on Cloud Run) via `apps/web/start.mjs` and proxies `/api/*` server-side to `API_INTERNAL_URL` (automatically populated in `cloudbuild.yaml` from the deployed API service URL).
- **Secrets**: Stored in US-regional Secret Manager (`--replication-policy=user-managed --locations=us-west1`) with per-environment isolation (`interstate-staging-*` vs `interstate-prod-*`).

---

## Prerequisites & Local Authentication

1. **Authenticate `gcloud` CLI** (interactive browser login):
   ```powershell
   gcloud auth login
   ```
2. **Confirm your GCP Project ID and Billing Account**:
   ```powershell
   gcloud projects list --limit=20 --format="table(projectId,name,projectNumber)"
   ```
   Ensure billing is linked to your target `<PROJECT_ID>` in the Google Cloud Console before enabling APIs.
3. **Provision Neon Postgres US Databases**:
   Create `interstate-staging` and `interstate-prod` branches in Neon (US region, e.g. `aws-us-west-2`) and copy each pooled connection string (`sslmode=require`).

---

## 4-Step Validated Provisioning Procedure

### Step 1: Syntax Validation via `gcloud help <leaf_command>`
Every leaf command used in `infra/gcp/provision-env.ps1` and `cloudbuild.yaml` was verified with `gcloud help`:
- `gcloud help services enable`
- `gcloud help artifacts repositories create`
- `gcloud help storage buckets create`
- `gcloud help storage buckets add-iam-policy-binding`
- `gcloud help iam service-accounts create`
- `gcloud help iam service-accounts add-iam-policy-binding`
- `gcloud help secrets create`
- `gcloud help secrets versions add`
- `gcloud help secrets add-iam-policy-binding`
- `gcloud help projects add-iam-policy-binding`
- `gcloud help run jobs deploy`
- `gcloud help run jobs execute`
- `gcloud help run deploy`
- `gcloud help run services describe`
- `gcloud help builds triggers create github`
- `gcloud help builds submit`

### Step 2: Parameter Verification
- **Required parameters**: `-ProjectId <PROJECT_ID>`, `-Env <staging|prod>`.
- **Defaults**: `-Region us-west1`, `-RepoName interstate-homes`, `-BucketName <project-id>-interstate-docs-<env>`.
- **Dry-run support**: `gcloud` provisioning subcommands (`services enable`, `artifacts repositories create`, `storage buckets create`, `secrets create`, `iam service-accounts create`, `add-iam-policy-binding`) do not provide native `--dry-run` flags, so `infra/gcp/provision-env.ps1` defaults to **Dry-Run Preview Mode** (prints every exact command without executing anything) unless `-Execute` is explicitly passed.

### Step 3: Dry-Run Command Proposal
Run the preview first for Staging and Production to inspect every exact command and target `<PROJECT_ID>`:
```powershell
.\infra\gcp\provision-env.ps1 -ProjectId "<PROJECT_ID>" -Env staging
.\infra\gcp\provision-env.ps1 -ProjectId "<PROJECT_ID>" -Env prod
```

### Step 4: Command Proposal & Authorization
> [!CAUTION]
> The commands enabled by `-Execute` include **API enablement** (`gcloud services enable`) and **IAM policy bindings** (`gcloud projects add-iam-policy-binding`, `gcloud secrets add-iam-policy-binding`, `gcloud storage buckets add-iam-policy-binding`, `gcloud iam service-accounts add-iam-policy-binding`). Autonomous execution is prohibited; execute only after reviewing Step 3 output and confirming `<PROJECT_ID>`.

Once authorized, run:
```powershell
.\infra\gcp\provision-env.ps1 -ProjectId "<PROJECT_ID>" -Env staging -Execute
.\infra\gcp\provision-env.ps1 -ProjectId "<PROJECT_ID>" -Env prod -Execute
```

---

## Populate Secret Manager Values

Before triggering the first Cloud Build deployment, add initial versions for all 5 secrets in each environment. Use a UTF-8 file (without trailing newline) rather than `Write-Output` (PowerShell appends a newline with `Write-Output`):

```powershell
# Helper to safely add a secret without trailing newline
function Set-GcpSecretValue {
    param([string]$ProjectId, [string]$SecretName, [string]$Value)
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        [System.IO.File]::WriteAllText($tmp, $Value, [System.Text.UTF8Encoding]::new($false))
        gcloud secrets versions add $SecretName --data-file=$tmp --project=$ProjectId --quiet
    } finally {
        Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue
    }
}

# Example for Staging:
Set-GcpSecretValue -ProjectId "<PROJECT_ID>" -SecretName "interstate-staging-database-url"       -Value "postgresql://..."
Set-GcpSecretValue -ProjectId "<PROJECT_ID>" -SecretName "interstate-staging-app-encryption-key" -Value "<64-char-hex-key>"
Set-GcpSecretValue -ProjectId "<PROJECT_ID>" -SecretName "interstate-staging-session-secret"     -Value "<long-random-secret>"
Set-GcpSecretValue -ProjectId "<PROJECT_ID>" -SecretName "interstate-staging-docuseal-api-key"   -Value "<docuseal-key-or-placeholder>"
Set-GcpSecretValue -ProjectId "<PROJECT_ID>" -SecretName "interstate-staging-resend-api-key"     -Value "<resend-key-or-placeholder>"
```

Generate cryptographically strong keys in PowerShell:
```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Minimum 0 -Maximum 256) })
```
*(Or in Node.js: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)*

---

## Connect GitHub & Create CI/CD Triggers

1. In Google Cloud Console, navigate to **Cloud Build -> Repositories (2nd gen)** in region **`us-west1`** and connect GitHub repository **`mcevesfam/InterstateHomes`**.
2. Create the **Staging** trigger (`staging` branch):
   ```powershell
   gcloud builds triggers create github `
     --name="interstate-homes-staging" `
     --region="us-west1" `
     --repository="projects/<PROJECT_ID>/locations/us-west1/connections/<CONNECTION_NAME>/repositories/<REPO_RESOURCE>" `
     --branch-pattern="^staging$" `
     --build-config="cloudbuild.yaml" `
     --substitutions="_ENV=staging,_REGION=us-west1,_REPO=interstate-homes,_API_SERVICE=interstate-api-staging,_WEB_SERVICE=interstate-web-staging,_MIGRATE_JOB=interstate-migrate-staging,_GCS_BUCKET=<PROJECT_ID>-interstate-docs-staging,_CORS_ORIGIN=https://staging.interstatehomes.com,_EMAIL_PROVIDER=console,_EMAIL_FROM=estimating@interstatehomes.com" `
     --project="<PROJECT_ID>" `
     --quiet
   ```
3. Create the **Production** trigger (`main` branch):
   ```powershell
   gcloud builds triggers create github `
     --name="interstate-homes-prod" `
     --region="us-west1" `
     --repository="projects/<PROJECT_ID>/locations/us-west1/connections/<CONNECTION_NAME>/repositories/<REPO_RESOURCE>" `
     --branch-pattern="^main$" `
     --build-config="cloudbuild.yaml" `
     --substitutions="_ENV=prod,_REGION=us-west1,_REPO=interstate-homes,_API_SERVICE=interstate-api-prod,_WEB_SERVICE=interstate-web-prod,_MIGRATE_JOB=interstate-migrate-prod,_GCS_BUCKET=<PROJECT_ID>-interstate-docs-prod,_CORS_ORIGIN=https://interstatehomes.com,_EMAIL_PROVIDER=console,_EMAIL_FROM=estimating@interstatehomes.com" `
     --project="<PROJECT_ID>" `
     --quiet
   ```

---

## Custom Domain (`interstatehomes.com` on Bluehost) & Outbound Email (Resend)

Because `apps/web` proxies `/api/*` server-side to `API_INTERNAL_URL`, only the **Web** Cloud Run service (`interstate-web-staging` / `interstate-web-prod`) needs a public custom domain.

### Step 1: Verify `interstatehomes.com` Ownership with Google (One-Time)
1. Run `gcloud domains verify interstatehomes.com --project=<PROJECT_ID>` (or open Google Search Console / Webmaster Central) to obtain the `google-site-verification=...` `TXT` token.
2. In **Bluehost → Domains → `interstatehomes.com` → DNS / Zone Editor**, add:
   - **Type:** `TXT` | **Host/Name:** `@` | **Value:** `google-site-verification=<your-token>` | **TTL:** `300` (or lowest allowed)
3. Click **Verify** in Google Search Console, then confirm:
   ```powershell
   gcloud domains list-user-verified --project=<PROJECT_ID> --format="json" --quiet
   ```

### Step 2: Connect Staging (`staging.interstatehomes.com`)
1. Deploy `interstate-web-staging` to `us-west1` at least once.
2. Ensure Staging GCS bucket CORS is applied (`infra/gcp/cors-staging.json`):
   ```powershell
   gcloud storage buckets update gs://<PROJECT_ID>-interstate-docs-staging `
     --cors-file=infra/gcp/cors-staging.json `
     --project=<PROJECT_ID> `
     --quiet
   ```
3. In **Google Cloud Console → Cloud Run → Manage Custom Domains → Add Mapping**:
   - Service: `interstate-web-staging` (`us-west1`)
   - Domain: `interstatehomes.com`, Subdomain: `staging` (`staging.interstatehomes.com`)
4. In **Bluehost DNS Zone Editor**, add the DNS record Google displays:
   - **Type:** `CNAME` | **Host/Name:** `staging` | **Points to:** `ghs.googlehosted.com.`
5. Wait ~15–60 minutes for DNS propagation and Google-managed TLS certificate issuance.

### Step 3: Connect Production (`interstatehomes.com` & `www.interstatehomes.com`) — After Approval
1. Provision Production (`.\infra\gcp\provision-env.ps1 -ProjectId "<PROJECT_ID>" -Env prod -Execute`), populate all 5 `interstate-prod-*` secrets, and deploy `interstate-web-prod` (`main` branch).
2. In **Google Cloud Console → Cloud Run → Manage Custom Domains → Add Mapping**:
   - Map apex `interstatehomes.com` → `interstate-web-prod` (note the **4 `A`** and **4 `AAAA`** IP records displayed).
   - Map `www.interstatehomes.com` → `interstate-web-prod` (note the **`CNAME`** `ghs.googlehosted.com.` record; `apps/web/next.config.ts` permanently redirects `www` → `https://interstatehomes.com`).
3. In **Bluehost DNS Zone Editor**:
   - Remove the old parked `A` records (`204.11.56.246`) on `@` and `www`.
   - Add the exact **4 `A`** + **4 `AAAA`** records for `@` and **`CNAME`** `www` → `ghs.googlehosted.com.`.

### Step 4: Configure Outbound Email via Resend (Deferred Until Sender Address Finalized)
1. In **Resend Dashboard → Domains → Add Domain**, add `interstatehomes.com` (US region).
2. Copy Resend's `DKIM` (`TXT`/`CNAME`) and `SPF` (`MX`/`TXT` on `send` subdomain) records into **Bluehost DNS Zone Editor**, plus add a DMARC record:
   - **Type:** `TXT` | **Host/Name:** `_dmarc` | **Value:** `v=DMARC1; p=none; rua=mailto:<your-chosen-sender>@interstatehomes.com`
3. Verify the domain in Resend, then update your Cloud Build trigger/deploy substitutions to `_EMAIL_PROVIDER=resend` and `_EMAIL_FROM=<your-chosen-sender>@interstatehomes.com`.

---

## Manual One-Off Build & Verification

To test the full pipeline manually from your local checkout (supplying `COMMIT_SHA` explicitly):
```powershell
$sha = (git rev-parse --short HEAD)
gcloud builds submit . `
  --config="cloudbuild.yaml" `
  --region="us-west1" `
  --substitutions="COMMIT_SHA=$sha,_ENV=staging,_REGION=us-west1,_REPO=interstate-homes,_API_SERVICE=interstate-api-staging,_WEB_SERVICE=interstate-web-staging,_MIGRATE_JOB=interstate-migrate-staging,_GCS_BUCKET=<PROJECT_ID>-interstate-docs-staging,_CORS_ORIGIN=https://staging.interstatehomes.com,_EMAIL_PROVIDER=console,_EMAIL_FROM=estimating@interstatehomes.com" `
  --project="<PROJECT_ID>" `
  --quiet
```

Verify deployed URLs and health:
```powershell
gcloud run services describe interstate-api-staging --region=us-west1 --project="<PROJECT_ID>" --format="value(status.url)"
gcloud run services describe interstate-web-staging --region=us-west1 --project="<PROJECT_ID>" --format="value(status.url)"
```
Then check `GET <WEB_URL>/api/health` and sign in with the seeded Admin account (immediately change the default admin password and enroll MFA!).
