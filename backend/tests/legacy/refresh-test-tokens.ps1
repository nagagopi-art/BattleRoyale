
$ErrorActionPreference = "Stop"

function Get-PlayerToken($playerName) {
    Write-Host ""
    Write-Host "Login for $playerName"

    $email = Read-Host "Enter player email"
    $securePassword = Read-Host "Enter player password" -AsSecureString

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

    try {
        $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)

        $body = @{
            email = $email
            password = $password
        } | ConvertTo-Json

        $response = Invoke-RestMethod `
            -Uri "http://localhost:5000/api/auth/login" `
            -Method Post `
            -ContentType "application/json" `
            -Body $body

        if ($response.status -ne "success" -or !$response.access_token) {
            throw "Login did not return a valid access token."
        }

        Write-Host "$playerName login successful."
        return $response.access_token
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $password = $null
    }
}

try {
    $player2Token = Get-PlayerToken "Player 2"
    $player1Token = Get-PlayerToken "Player 1"

    # .env lives in the backend root, two folders up.
    $envPath = Join-Path $PSScriptRoot "..\..\.env"
    $envText = Get-Content $envPath -Raw

    foreach ($entry in @(
        @{ Name = "PLAYER2_SOCKET_TOKEN"; Token = $player2Token },
        @{ Name = "PLAYER1_SOCKET_TOKEN"; Token = $player1Token }
    )) {
        $pattern = "(?m)^" + $entry.Name + "=.*$"
        $replacement = $entry.Name + "=" + $entry.Token

        if ([regex]::IsMatch($envText, $pattern)) {
            $envText = [regex]::Replace(
                $envText, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{
                    param($match)
                    $replacement
                }
            )
        }
        else {
            $envText += "`r`n" + $replacement
        }
    }

    Set-Content -Path $envPath -Value $envText -NoNewline

    Write-Host ""
    Write-Host "SUCCESS: Both test tokens updated in .env"
}
catch {
    Write-Host ""
    Write-Host "TOKEN REFRESH FAILED:"
    Write-Host $_.Exception.Message
}
