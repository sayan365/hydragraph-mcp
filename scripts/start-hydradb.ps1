$ErrorActionPreference = "Stop"

docker info *> $null

$runtimeRoot = Join-Path $PSScriptRoot "..\.hydradb"
$store = Join-Path $runtimeRoot "store"
$cache = Join-Path $runtimeRoot "cache"
$tokenFile = Join-Path $runtimeRoot "auth-token"

New-Item -ItemType Directory -Force -Path $store, $cache | Out-Null
Set-Content -LiteralPath $tokenFile -Value "local-development-token-32-bytes" -NoNewline

$existing = docker ps -a --filter "name=^/hydragraph-hydradb$" --format "{{.Names}}"
if ($existing -eq "hydragraph-hydradb") {
    docker start hydragraph-hydradb | Out-Null
} else {
    $mount = $runtimeRoot.Replace("\", "/")
    docker run -d --name hydragraph-hydradb `
        -p 127.0.0.1:7687:7687 `
        -p 127.0.0.1:8443:8443 `
        -p 127.0.0.1:9090:9090 `
        -v "${mount}:/data" `
        -e CLOUD_PROVIDER=local `
        -e LOCAL_PATH=/data/store `
        -e GRAPH_NAMESPACE=default `
        -e GRAPH_ID=default `
        -e GRAPH_CELL_ID=cell-0 `
        -e GRAPH_CELLS=cell-0 `
        -e GRAPH_NODE_ID=node-0 `
        -e GRAPH_BOLT_NODE_ADDRESSES=node-0=127.0.0.1:7687 `
        -e GRAPH_ADVERTISED_BOLT_ADDR=127.0.0.1:7687 `
        -e GRAPH_DATA_CACHE_DIR=/data/cache `
        -e GRAPH_AUTH_TOKEN_FILE=/data/auth-token `
        -e GRAPH_ALLOW_PLAINTEXT=true `
        -e RUST_MIN_STACK=33554432 `
        ghcr.io/hydra-db/hydradb:latest | Out-Null
}

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:9090/readyz" | Out-Null
        $ready = $true
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}

if (-not $ready) {
    docker logs --tail 40 hydragraph-hydradb
    throw "HydraDB did not become ready on http://127.0.0.1:9090/readyz"
}

Write-Output "HydraDB is ready: HTTP 8443, Bolt 7687, admin 9090."
