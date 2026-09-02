[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$SourceSha
)

$ErrorActionPreference = 'Stop'
$actualSha = (git rev-parse HEAD).Trim()
Write-Output "requestedSourceSha=$SourceSha"
Write-Output "checkedOutSourceSha=$actualSha"
if ($actualSha -ne $SourceSha) {
    throw "Checkout SHA mismatch. expected=$SourceSha actual=$actualSha"
}
Write-Output 'checkoutVerified=true'
