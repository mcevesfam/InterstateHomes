<#
.SYNOPSIS
    Provisions Google Cloud infrastructure for Interstate Homes (Staging or Production) in us-west1.

.DESCRIPTION
    Dry-run by default: prints every validated gcloud command for review without executing
    mutating, API-enabling, or IAM-modifying operations. Pass -Execute ONLY after reviewing
    the dry-run output and confirming the target ProjectId and billing configuration.

    All gcloud commands in this script have been leaf-syntax validated against Google Cloud SDK 594.0.1.

.PARAMETER ProjectId
    Target Google Cloud Project ID (required).

.PARAMETER Env
    Target environment: 'staging' or 'prod'. Defaults to 'staging'.

.PARAMETER Region
    US GCP region. Defaults to 'us-west1'.

.PARAMETER RepoName
    Artifact Registry Docker repository name. Defaults to 'interstate-homes'.

.PARAMETER BucketName
    Globally unique private GCS bucket name. Defaults to "<ProjectId>-interstate-docs-<Env>".

.PARAMETER CloudBuildServiceAccount
    Optional Cloud Build service account email (defaults to "<PROJECT_NUMBER>@cloudbuild.gserviceaccount.com"
    or your dedicated Cloud Build SA).

.PARAMETER GithubRepoResource
    Optional 2nd-gen Cloud Build GitHub repository resource path, e.g.
    "projects/<PROJECT_ID>/locations/us-west1/connections/github/repositories/mcevesfam-InterstateHomes".
    If omitted, prints instructions for creating the GitHub trigger once connected in Cloud Console.

.PARAMETER Execute
    When omitted (default), runs in DRY-RUN preview mode and executes NO mutating commands.
    Pass -Execute to actually run the commands against -ProjectId.

.EXAMPLE
    # Step 1: Dry-run preview for Staging (safe, makes zero changes)
    .\infra\gcp\provision-env.ps1 -ProjectId "interstate-homes-gcp" -Env staging

.EXAMPLE
    # Step 2: Execute after reviewing output and confirming project/billing
    .\infra\gcp\provision-env.ps1 -ProjectId "interstate-homes-gcp" -Env staging -Execute
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectId,

    [ValidateSet('staging', 'prod')]
    [string]$Env = 'staging',

    [string]$Region = 'us-west1',

    [string]$RepoName = 'interstate-homes',

    [string]$BucketName = '',

    [string]$CorsOrigin = '',

    [string]$EmailProvider = 'console',

    [string]$EmailFrom = 'estimating@interstatehomes.com',

    [string]$CloudBuildServiceAccount = '',

    [string]$GithubRepoResource = '',

    [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($BucketName)) {
    $BucketName = "$ProjectId-interstate-docs-$Env".ToLowerInvariant()
}

if ([string]::IsNullOrWhiteSpace($CorsOrigin)) {
    $CorsOrigin = if ($Env -eq 'prod') { 'https://interstatehomes.com' } else { 'https://staging.interstatehomes.com' }
}

$CorsFile = Join-Path $PSScriptRoot "cors-$Env.json"
if (-not (Test-Path $CorsFile)) {
    throw "CORS policy file not found: $CorsFile"
}

$ApiService   = "interstate-api-$Env"
$WebService   = "interstate-web-$Env"
$MigrateJob   = "interstate-migrate-$Env"
$ApiSaName    = "interstate-api-$Env"
$WebSaName    = "interstate-web-$Env"
$ApiSaEmail   = "$ApiSaName@$ProjectId.iam.gserviceaccount.com"
$WebSaEmail   = "$WebSaName@$ProjectId.iam.gserviceaccount.com"
$BranchRegex  = if ($Env -eq 'prod') { '^main$' } else { '^staging$' }
$TriggerName  = "interstate-homes-$Env"

$Secrets = @(
    "interstate-$Env-database-url",
    "interstate-$Env-app-encryption-key",
    "interstate-$Env-session-secret",
    "interstate-$Env-docuseal-api-key",
    "interstate-$Env-resend-api-key"
)

$RequiredApis = @(
    'run.googleapis.com',
    'cloudbuild.googleapis.com',
    'artifactregistry.googleapis.com',
    'secretmanager.googleapis.com',
    'storage.googleapis.com',
    'iam.googleapis.com',
    'iamcredentials.googleapis.com'
)

function Resolve-GcloudPath {
    $cmd = Get-Command gcloud -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
        "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd",
        "C:\Program Files\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    throw "gcloud CLI not found. Install Google Cloud SDK and run 'gcloud auth login' first."
}

$GcloudBin = Resolve-GcloudPath

function Invoke-GcloudStep {
    param(
        [string]$Label,
        [string[]]$Arguments,
        [switch]$AllowAlreadyExists
    )
    $rendered = "gcloud " + (($Arguments | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join ' ')
    Write-Host ""
    Write-Host "==> [$Label]" -ForegroundColor Cyan
    if (-not $Execute) {
        Write-Host "[DRY-RUN] $rendered" -ForegroundColor Yellow
        return
    }
    Write-Host "[EXEC] $rendered" -ForegroundColor Green
    & $GcloudBin @Arguments
    if ($LASTEXITCODE -ne 0) {
        if ($AllowAlreadyExists) {
            Write-Warning "Step '$Label' exited with code $LASTEXITCODE (if the resource already exists, this is safe to ignore)."
        } else {
            throw "Command failed with exit code ${LASTEXITCODE}: $rendered"
        }
    }
}

Write-Host "================================================================="
Write-Host " Interstate Homes GCP Provisioning ($Env)"
Write-Host " Project      : $ProjectId"
Write-Host " Region       : $Region"
Write-Host " Artifact Repo: $RepoName"
Write-Host " GCS Bucket   : gs://$BucketName"
Write-Host " API Service  : $ApiService (SA: $ApiSaEmail)"
Write-Host " Web Service  : $WebService (SA: $WebSaEmail)"
Write-Host " Migrate Job  : $MigrateJob"
Write-Host " Mode         : $(if ($Execute) { 'EXECUTE (LIVE CHANGES)' } else { 'DRY-RUN PREVIEW (NO CHANGES)' })"
Write-Host "================================================================="

if ($Execute) {
    $activeAccount = (& $GcloudBin auth list --filter="status:ACTIVE" --format="value(account)")
    if ([string]::IsNullOrWhiteSpace($activeAccount)) {
        throw "No active gcloud account. Run 'gcloud auth login' first."
    }
    Write-Host "Active gcloud account: $activeAccount" -ForegroundColor Green
}

# 1. Enable required GCP APIs (requires user confirmation / billing enabled on project)
Invoke-GcloudStep -Label "Enable required GCP APIs" -Arguments (
    @('services', 'enable') + $RequiredApis + @("--project=$ProjectId", '--quiet')
)

# 2. Create Artifact Registry Docker repository (idempotent if shared between staging & prod)
Invoke-GcloudStep -Label "Create Artifact Registry repository ($RepoName)" -AllowAlreadyExists -Arguments @(
    'artifacts', 'repositories', 'create', $RepoName,
    "--location=$Region",
    '--repository-format=docker',
    '--description=Interstate Homes container images',
    "--project=$ProjectId",
    '--quiet'
)

# 3. Create private US-regional GCS bucket (uniform access + public access prevention enforced)
Invoke-GcloudStep -Label "Create private GCS bucket (gs://$BucketName)" -AllowAlreadyExists -Arguments @(
    'storage', 'buckets', 'create', "gs://$BucketName",
    "--location=$Region",
    '--default-storage-class=STANDARD',
    '--uniform-bucket-level-access',
    '--public-access-prevention',
    "--project=$ProjectId",
    '--quiet'
)

Invoke-GcloudStep -Label "Configure GCS bucket CORS (gs://$BucketName from cors-$Env.json)" -Arguments @(
    'storage', 'buckets', 'update', "gs://$BucketName",
    "--cors-file=$CorsFile",
    "--project=$ProjectId",
    '--quiet'
)

# 4. Create dedicated least-privilege runtime service accounts
Invoke-GcloudStep -Label "Create API runtime service account ($ApiSaName)" -AllowAlreadyExists -Arguments @(
    'iam', 'service-accounts', 'create', $ApiSaName,
    "--display-name=Interstate Homes API ($Env)",
    "--project=$ProjectId",
    '--quiet'
)

Invoke-GcloudStep -Label "Create Web runtime service account ($WebSaName)" -AllowAlreadyExists -Arguments @(
    'iam', 'service-accounts', 'create', $WebSaName,
    "--display-name=Interstate Homes Web ($Env)",
    "--project=$ProjectId",
    '--quiet'
)

# 5. Grant API SA bucket access + self-signing permission for V4 GCS signed URLs (zero static keys)
Invoke-GcloudStep -Label "Grant API SA objectAdmin on gs://$BucketName" -Arguments @(
    'storage', 'buckets', 'add-iam-policy-binding', "gs://$BucketName",
    "--member=serviceAccount:$ApiSaEmail",
    '--role=roles/storage.objectAdmin',
    "--project=$ProjectId",
    '--quiet'
)

Invoke-GcloudStep -Label "Grant API SA Service Account Token Creator on itself (V4 signed URLs)" -Arguments @(
    'iam', 'service-accounts', 'add-iam-policy-binding', $ApiSaEmail,
    "--member=serviceAccount:$ApiSaEmail",
    '--role=roles/iam.serviceAccountTokenCreator',
    "--project=$ProjectId",
    '--quiet'
)

# 6. Create US-regional Secret Manager shells & grant API SA secretAccessor
foreach ($secret in $Secrets) {
    Invoke-GcloudStep -Label "Create Secret Manager secret ($secret)" -AllowAlreadyExists -Arguments @(
        'secrets', 'create', $secret,
        '--replication-policy=user-managed',
        "--locations=$Region",
        "--project=$ProjectId",
        '--quiet'
    )

    Invoke-GcloudStep -Label "Grant API SA secretAccessor on $secret" -Arguments @(
        'secrets', 'add-iam-policy-binding', $secret,
        "--member=serviceAccount:$ApiSaEmail",
        '--role=roles/secretmanager.secretAccessor',
        "--project=$ProjectId",
        '--quiet'
    )
}

# 7. Grant Cloud Build SA deployment roles (Artifact Registry Writer, Cloud Run Admin, Service Account User)
if ([string]::IsNullOrWhiteSpace($CloudBuildServiceAccount)) {
    if ($Execute) {
        $projectNumber = (& $GcloudBin projects describe $ProjectId --format="value(projectNumber)" --quiet)
        $CloudBuildServiceAccount = "$projectNumber@cloudbuild.gserviceaccount.com"
    } else {
        $CloudBuildServiceAccount = "<PROJECT_NUMBER>@cloudbuild.gserviceaccount.com"
    }
}

foreach ($role in @('roles/run.admin', 'roles/artifactregistry.writer', 'roles/logging.logWriter')) {
    Invoke-GcloudStep -Label "Grant Cloud Build SA $role" -Arguments @(
        'projects', 'add-iam-policy-binding', $ProjectId,
        "--member=serviceAccount:$CloudBuildServiceAccount",
        "--role=$role",
        '--quiet'
    )
}

foreach ($runtimeSa in @($ApiSaEmail, $WebSaEmail)) {
    Invoke-GcloudStep -Label "Grant Cloud Build SA iam.serviceAccountUser on $runtimeSa" -Arguments @(
        'iam', 'service-accounts', 'add-iam-policy-binding', $runtimeSa,
        "--member=serviceAccount:$CloudBuildServiceAccount",
        '--role=roles/iam.serviceAccountUser',
        "--project=$ProjectId",
        '--quiet'
    )
}

# 8. Create Cloud Build GitHub trigger (if 2nd-gen repository resource was provided)
$Substitutions = "_ENV=$Env,_REGION=$Region,_REPO=$RepoName,_API_SERVICE=$ApiService,_WEB_SERVICE=$WebService,_MIGRATE_JOB=$MigrateJob,_GCS_BUCKET=$BucketName,_CORS_ORIGIN=$CorsOrigin,_EMAIL_PROVIDER=$EmailProvider,_EMAIL_FROM=$EmailFrom"

if (-not [string]::IsNullOrWhiteSpace($GithubRepoResource)) {
    Invoke-GcloudStep -Label "Create Cloud Build GitHub trigger ($TriggerName -> $BranchRegex)" -AllowAlreadyExists -Arguments @(
        'builds', 'triggers', 'create', 'github',
        "--name=$TriggerName",
        "--region=$Region",
        "--repository=$GithubRepoResource",
        "--branch-pattern=$BranchRegex",
        '--build-config=cloudbuild.yaml',
        "--substitutions=$Substitutions",
        "--project=$ProjectId",
        '--quiet'
    )
} else {
    Write-Host ""
    Write-Host "==> [Next Step: Connect GitHub & Create Trigger]" -ForegroundColor Cyan
    Write-Host "Connect https://github.com/mcevesfam/InterstateHomes in Cloud Build -> Repositories (2nd gen) in region $Region,"
    Write-Host "then re-run or execute:"
    Write-Host "  gcloud builds triggers create github --name=$TriggerName --region=$Region --repository=projects/$ProjectId/locations/$Region/connections/<CONN>/repositories/<REPO> --branch-pattern=`"$BranchRegex`" --build-config=cloudbuild.yaml --substitutions=`"$Substitutions`" --project=$ProjectId --quiet"
}

Write-Host ""
if (-not $Execute) {
    Write-Host "DRY-RUN COMPLETE. No GCP resources were modified." -ForegroundColor Yellow
    Write-Host "Re-run with -Execute once you have signed in ('gcloud auth login') and confirmed ProjectId '$ProjectId'." -ForegroundColor Yellow
} else {
    Write-Host "PROVISIONING COMPLETE for '$Env' in project '$ProjectId' ($Region)." -ForegroundColor Green
    Write-Host "Next: populate secret versions for:" -ForegroundColor Green
    $Secrets | ForEach-Object { Write-Host "  - $_" }
}
