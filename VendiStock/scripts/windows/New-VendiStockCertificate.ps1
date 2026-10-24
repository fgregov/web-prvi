<#
.SYNOPSIS
  Izrada lokalnog HTTPS certifikata za VendiStock (vlastiti CA + certifikat servera).
.DESCRIPTION
  - Stvara lokalni korijenski certifikat (CA) "VendiStock Local CA" i instalira ga u
    "Trusted Root Certification Authorities" ovog računala.
  - Stvara certifikat servera s nazivima (SAN): naziv računala, localhost, 127.0.0.1 i zadana LAN IP adresa.
  - Izvozi certs\vendistock-server.pfx (za server) i certs\vendistock-ca.cer (za instalaciju na
    klijentskim računalima u uredu, kako preglednici ne bi prikazivali upozorenje).
  Pokrenuti kao administrator:
    .\scripts\windows\New-VendiStockCertificate.ps1 -IpAddress 192.168.1.50
.PARAMETER IpAddress
  LAN IP adresa servera (mora odgovarati adresi koju korisnici upisuju u preglednik).
#>
param(
  [Parameter(Mandatory = $true)][string]$IpAddress,
  [string]$DnsName = $env:COMPUTERNAME,
  [int]$ValidYears = 5
)
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$Certs = Join-Path $Root 'certs'
New-Item -ItemType Directory -Force -Path $Certs | Out-Null

$ca = New-SelfSignedCertificate -Type Custom -KeySpec Signature -Subject 'CN=VendiStock Local CA, O=Vending Express' `
  -KeyExportPolicy Exportable -HashAlgorithm sha256 -KeyLength 4096 -CertStoreLocation 'Cert:\LocalMachine\My' `
  -KeyUsageProperty Sign -KeyUsage CertSign, CRLSign, DigitalSignature -NotAfter (Get-Date).AddYears($ValidYears + 1) `
  -TextExtension @('2.5.29.19={critical}{text}ca=true&pathlength=0')

$san = "2.5.29.17={text}DNS=$DnsName&DNS=localhost&IPAddress=127.0.0.1&IPAddress=$IpAddress"
$server = New-SelfSignedCertificate -Type Custom -Subject "CN=$DnsName, O=Vending Express" -DnsName $DnsName, 'localhost' `
  -Signer $ca -KeyExportPolicy Exportable -HashAlgorithm sha256 -KeyLength 2048 -CertStoreLocation 'Cert:\LocalMachine\My' `
  -NotAfter (Get-Date).AddYears($ValidYears) -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.1', $san)

$pass = Read-Host 'Lozinka za PFX datoteku (upisat ćete je u .env kao HTTPS_PFX_PASSPHRASE)' -AsSecureString
Export-PfxCertificate -Cert $server -FilePath (Join-Path $Certs 'vendistock-server.pfx') -Password $pass -ChainOption BuildChain | Out-Null
Export-Certificate -Cert $ca -FilePath (Join-Path $Certs 'vendistock-ca.cer') | Out-Null

# CA u pouzdane korijenske certifikate ovog računala
Import-Certificate -FilePath (Join-Path $Certs 'vendistock-ca.cer') -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
# Privatni ključ CA nije potreban nakon izdavanja – uklanja se iz spremišta
Remove-Item -Path ("Cert:\LocalMachine\My\" + $ca.Thumbprint) -DeleteKey

icacls $Certs /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null

Write-Host ''
Write-Host 'Certifikati izrađeni:' -ForegroundColor Green
Write-Host "  Server: $Certs\vendistock-server.pfx"
Write-Host "  CA (za klijente): $Certs\vendistock-ca.cer"
Write-Host ''
Write-Host 'U .env postavite:'
Write-Host '  HTTPS_ENABLED=true'
Write-Host '  HTTPS_PFX_PATH=certs/vendistock-server.pfx'
Write-Host '  HTTPS_PFX_PASSPHRASE=<lozinka>'
Write-Host "  VENDISTOCK_PUBLIC_URL=https://${IpAddress}:3000"
Write-Host ''
Write-Host 'Na svakom uredskom računalu instalirajte vendistock-ca.cer u "Trusted Root Certification Authorities"'
Write-Host '(dvoklik → Install Certificate → Local Machine → Trusted Root Certification Authorities).'
