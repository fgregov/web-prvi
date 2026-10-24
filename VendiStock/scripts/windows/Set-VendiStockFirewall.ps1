<#
.SYNOPSIS
  Pravilo Windows vatrozida za VendiStock: dolazni TCP promet samo iz lokalne podmreže, samo na privatnom profilu.
.DESCRIPTION
  Aplikacija ne smije biti dostupna s interneta. Pravilo dopušta pristup samo s uređaja u istoj lokalnoj
  podmreži (LocalSubnet) i samo kad je mreža označena kao „Private”. Na routeru NE otvarati port (bez port-forwardinga).
  Pokrenuti kao administrator:
    .\scripts\windows\Set-VendiStockFirewall.ps1 -Port 3000
#>
param([int]$Port = 3000)
$ErrorActionPreference = 'Stop'
$name = 'VendiStock (TCP ' + $Port + ', LAN)'
Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow `
  -Profile Private -RemoteAddress LocalSubnet -Description 'VendiStock – pristup samo iz uredske lokalne mreže' | Out-Null
Write-Host "Pravilo '$name' stvoreno (Private profil, samo LocalSubnet)." -ForegroundColor Green
$profiles = Get-NetConnectionProfile | Select-Object InterfaceAlias, NetworkCategory
$profiles | Format-Table
if ($profiles.NetworkCategory -contains 'Public') {
  Write-Host 'UPOZORENJE: neka mrežna sučelja su označena kao Public. Uredsku mrežu označite kao Private:' -ForegroundColor Yellow
  Write-Host '  Set-NetConnectionProfile -InterfaceAlias "<naziv>" -NetworkCategory Private'
}
