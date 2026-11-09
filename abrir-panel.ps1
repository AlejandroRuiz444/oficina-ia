# Abre la Oficina (panel de control). Cada arranque genera un token nuevo, asi que si ya habia un panel nuestro corriendo se reinicia.
$ing  = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 7321
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show('No encuentro Node.js. Instalalo desde https://nodejs.org', 'Oficina'); exit 1 }

$c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($c) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c[0].OwningProcess)"
  if ($p -and $p.CommandLine -like '*server.js*') {
    Stop-Process -Id $p.ProcessId -Force   # nuestro panel anterior: se reemplaza por uno con token nuevo
    Start-Sleep -Seconds 1
  } else {
    Add-Type -AssemblyName PresentationFramework
    [void][System.Windows.MessageBox]::Show("El puerto $port esta ocupado por otro programa. Cierralo e intenta de nuevo.", 'Oficina')
    exit 1
  }
}
# --open abre el navegador con el enlace que lleva el token
Start-Process -FilePath $node -ArgumentList 'server.js', '--open' -WorkingDirectory $ing -WindowStyle Hidden
