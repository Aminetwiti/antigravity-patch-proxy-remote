# Test complet du flux WebSocket daemon : list_sessions -> send_prompt -> stream_delta
# ZÃ©ro dÃ©pendance : .NET ClientWebSocket (stdlib).
$ErrorActionPreference = 'Stop'
$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$ct = [System.Threading.CancellationToken]::None
$bindHost = if ($env:AG_BIND_HOST) { $env:AG_BIND_HOST } else { '127.0.0.1' }
$uri = "ws://${bindHost}:8090/ws?token=demo123"
Write-Output "== Connexion Ã  $uri"
$ws.ConnectAsync([Uri]$uri, $ct).GetAwaiter().GetResult()
Write-Output "== ConnectÃ© (State: $($ws.State))"

function Send-WS([string]$json) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $seg = [System.ArraySegment[byte]]::new($bytes)
    $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).GetAwaiter().GetResult()
}

function Recv-WS([int]$timeoutSec = 15) {
    $buf = New-Object byte[] 262144
    $ms = New-Object System.IO.MemoryStream
    $cts = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($timeoutSec))
    try {
        do {
            $seg = [System.ArraySegment[byte]]::new($buf)
            $res = $ws.ReceiveAsync($seg, $cts.Token).GetAwaiter().GetResult()
            if ($res.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { return '<<CLOSE>>' }
            $ms.Write($buf, 0, $res.Count)
        } while (-not $res.EndOfMessage)
    } catch { return '<<TIMEOUT>>' }
    return [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
}

# 1. list_sessions
Send-WS '{"type":"list_sessions","requestId":"t1"}'
$resp = Recv-WS 10
Write-Output "== list_sessions -> $resp"

# Extraire la cascadeId de la session la plus rÃ©cente
$json = $resp | ConvertFrom-Json
$sessions = $json.data.sessions
if (-not $sessions -or $sessions.Count -eq 0) { Write-Output "!! Aucune session"; exit 1 }
$s = $sessions | Sort-Object updatedAt -Descending | Select-Object -First 1
Write-Output "== Session choisie: $($s.title) (cascadeId=$($s.cascadeId))"

# 2. send_prompt
Send-WS ('{"type":"send_prompt","requestId":"t2","cascadeId":"' + $s.cascadeId + '","prompt":"Reponds juste OK"}')
Write-Output "== send_prompt envoyÃ©, attente du stream..."

$start = Get-Date
$count = 0
while ((Get-Date) - $start -lt [TimeSpan]::FromSeconds(90)) {
    $m = Recv-WS 20
    if ($m -eq '<<TIMEOUT>>') { Write-Output "   (timeout rÃ©ception)"; continue }
    if ($m -eq '<<CLOSE>>') { Write-Output "== Connexion fermÃ©e par le serveur"; break }
    $count++
    $short = if ($m.Length -gt 300) { $m.Substring(0, 300) + '...' } else { $m }
    Write-Output "[$count] $short"
    if ($m -match '"type":"stream_end"') { Write-Output "== STREAM TERMINÃ‰"; break }
}
Write-Output "== Total messages reÃ§us: $count"
$ws.Dispose()

