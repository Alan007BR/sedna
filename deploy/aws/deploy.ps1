# Deploys the SEDNA data service to AWS Lambda as a container image, with a public HTTPS function URL that
# streams responses. Safe to run again: it updates the image and settings of what already exists.
#
# Needs the AWS CLI v2, logged in (aws login, or aws configure), and Docker in WSL (Debian).
#   powershell -ExecutionPolicy Bypass -File deploy\aws\deploy.ps1
# Code written with AI assistance (Claude); see AI_USAGE.md.
param(
  # The SPHEREx bucket (nasa-irsa-spherex) is in us-east-1; this account's organization allows only us-east-2,
  # next door, and reading a public Open Data bucket from there costs the reader nothing.
  [string]$Region = "us-east-2",
  [string]$Name = "sedna-api",
  [int]$MemoryMb = 3008,
  [int]$TimeoutS = 300,
  [string]$Distro = "Debian"
)
$ErrorActionPreference = "Continue"
function Fail([string]$msg) { Write-Host "FAILED: $msg" -ForegroundColor Red; exit 1 }
function Step([string]$msg) { Write-Host "== $msg" -ForegroundColor Cyan }

$repoWin = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$repoWsl = (wsl -d $Distro -- wslpath -a ($repoWin -replace '\\', '/')).Trim()
$account = (aws sts get-caller-identity --query Account --output text)
if ($LASTEXITCODE -ne 0 -or -not $account) { Fail "the AWS CLI is not logged in (run: aws login --region $Region)" }
$registry = "$account.dkr.ecr.$Region.amazonaws.com"
$image = "$registry/${Name}:latest"
Write-Host "account $account, region $Region, image $image"

Step "image repository"
aws ecr describe-repositories --repository-names $Name --region $Region *> $null
if ($LASTEXITCODE -ne 0) {
  aws ecr create-repository --repository-name $Name --region $Region --output text --query repository.repositoryUri
  if ($LASTEXITCODE -ne 0) { Fail "could not create the image repository" }
}

Step "build and push the image"
# PowerShell 5.1 re-encodes piped text for native programs, which corrupts the token: hand it over in a
# file with no line break instead, and delete the file at once
$tokenFile = Join-Path $env:TEMP "sedna-ecr-token.txt"
$token = (aws ecr get-login-password --region $Region)
[IO.File]::WriteAllText($tokenFile, $token.Trim(), [Text.Encoding]::ASCII)
$tokenWsl = (wsl -d $Distro -- wslpath -a ($tokenFile -replace '\\', '/')).Trim()
wsl -d $Distro -- bash -c "docker login --username AWS --password-stdin '$registry' < '$tokenWsl'"
$loginExit = $LASTEXITCODE
Remove-Item $tokenFile -Force
if ($loginExit -ne 0) { Fail "docker login to ECR" }
# --provenance=false: Lambda does not accept image indexes with attestations
wsl -d $Distro -- bash -c "cd '$repoWsl' && docker build --platform linux/amd64 --provenance=false -f deploy/aws/Dockerfile -t '$image' . && docker push '$image'"
if ($LASTEXITCODE -ne 0) { Fail "docker build or push" }
$digest = (aws ecr describe-images --repository-name $Name --image-ids imageTag=latest --region $Region --query "imageDetails[0].imageDigest" --output text)
$imageUri = "$registry/$Name@$digest"

Step "execution role"
$roleName = "$Name-lambda"
$roleArn = (aws iam get-role --role-name $roleName --query Role.Arn --output text 2> $null)
if ($LASTEXITCODE -ne 0 -or -not $roleArn) {
  $trust = Join-Path $env:TEMP "sedna-trust.json"
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' | Out-File -Encoding ascii $trust
  $roleArn = (aws iam create-role --role-name $roleName --assume-role-policy-document "file://$trust" --query Role.Arn --output text)
  if ($LASTEXITCODE -ne 0) { Fail "could not create the execution role" }
  aws iam attach-role-policy --role-name $roleName --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  Write-Host "waiting for the new role to propagate"
  Start-Sleep -Seconds 12
}

Step "function"
aws lambda get-function --function-name $Name --region $Region *> $null
if ($LASTEXITCODE -ne 0) {
  aws lambda create-function --function-name $Name --region $Region --package-type Image --code "ImageUri=$imageUri" `
    --role $roleArn --memory-size $MemoryMb --timeout $TimeoutS --ephemeral-storage "Size=2048" --architectures x86_64 `
    --description "SEDNA data service (NASA Space Apps 2026)" --output text --query FunctionArn
  if ($LASTEXITCODE -ne 0) { Fail "could not create the function" }
  aws lambda wait function-active-v2 --function-name $Name --region $Region
} else {
  aws lambda update-function-code --function-name $Name --region $Region --image-uri $imageUri --output text --query LastUpdateStatus
  aws lambda wait function-updated-v2 --function-name $Name --region $Region
  aws lambda update-function-configuration --function-name $Name --region $Region --memory-size $MemoryMb --timeout $TimeoutS `
    --ephemeral-storage "Size=2048" --output text --query LastUpdateStatus
  aws lambda wait function-updated-v2 --function-name $Name --region $Region
}

Step "public function URL (streaming)"
$url = (aws lambda get-function-url-config --function-name $Name --region $Region --query FunctionUrl --output text 2> $null)
if ($LASTEXITCODE -ne 0 -or -not $url) {
  # no CORS here: the service already answers with Access-Control-Allow-Origin, and two such headers break browsers
  $url = (aws lambda create-function-url-config --function-name $Name --region $Region --auth-type NONE --invoke-mode RESPONSE_STREAM --query FunctionUrl --output text)
  if ($LASTEXITCODE -ne 0) { Fail "could not create the function URL" }
  aws lambda add-permission --function-name $Name --region $Region --statement-id PublicFunctionUrl `
    --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE --output text --query Statement | Out-Null
  aws lambda add-permission --function-name $Name --region $Region --statement-id PublicFunctionUrlInvoke `
    --action lambda:InvokeFunction --principal "*" --invoked-via-function-url --output text --query Statement 2> $null | Out-Null
} else {
  aws lambda update-function-url-config --function-name $Name --region $Region --auth-type NONE --invoke-mode RESPONSE_STREAM --output text --query FunctionUrl | Out-Null
}
$url = $url.TrimEnd('/')
Write-Host ""
Write-Host "Function URL: $url" -ForegroundColor Green
Write-Host "Health:"
curl.exe -s -m 60 "$url/api/health"
Write-Host ""
