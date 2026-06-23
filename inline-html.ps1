# Inline all CSS and JS into a single HTML file for easy sharing
# Usage: powershell -ExecutionPolicy Bypass -File inline-html.ps1

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$htmlFile = Join-Path $baseDir "app.html"
$outputFile = Join-Path $baseDir "monkeygtd-standalone.html"

Write-Host "Creating standalone HTML file..." -ForegroundColor Cyan

# Read original HTML
$html = [System.IO.File]::ReadAllText($htmlFile, [System.Text.Encoding]::UTF8)

# Extract CSS link and replace with inline style
$cssPattern = '<link rel="stylesheet" href="([^"]+)">'
$cssMatch = [regex]::Match($html, $cssPattern)
if ($cssMatch.Success) {
    $cssPath = $cssMatch.Groups[1].Value
    $cssFullPath = Join-Path $baseDir $cssPath
    if (Test-Path $cssFullPath) {
        $css = [System.IO.File]::ReadAllText($cssFullPath, [System.Text.Encoding]::UTF8)
        $styleTag = "<style>`r`n$css`r`n</style>"
        $html = $html -replace [regex]::Escape($cssMatch.Value), $styleTag
        Write-Host "Inlined CSS from $cssPath" -ForegroundColor Green
    } else {
        Write-Host "CSS file not found: $cssFullPath" -ForegroundColor Yellow
    }
}

# Extract and inline all script tags
$scriptMatches = @()
$scriptPattern = '<script src="([^"]+)"></script>'
[regex]::Matches($html, $scriptPattern) | ForEach-Object { $scriptMatches += $_ }

$scriptCount = 0
foreach ($match in $scriptMatches) {
    $scriptPath = $match.Groups[1].Value
    $scriptFullPath = Join-Path $baseDir $scriptPath
    
    if (Test-Path $scriptFullPath) {
        $js = [System.IO.File]::ReadAllText($scriptFullPath, [System.Text.Encoding]::UTF8)
        # Wrap in CDATA to preserve all special characters
        $scriptTag = "<script>`r`n$js`r`n</script>"
        $html = $html -replace [regex]::Escape($match.Value), $scriptTag
        $scriptCount++
        Write-Host "Inlined JS from $scriptPath" -ForegroundColor Green
    } else {
        Write-Host "JS file not found: $scriptFullPath" -ForegroundColor Yellow
    }
}

# Write inlined HTML
[System.IO.File]::WriteAllText($outputFile, $html, [System.Text.Encoding]::UTF8)

# Calculate file size
$newSize = (Get-Item $outputFile).Length
$sizeInMB = [math]::Round($newSize / 1MB, 2)

Write-Host "" 
Write-Host "Done! Created: $outputFile" -ForegroundColor Green
Write-Host "Size: $sizeInMB MB" -ForegroundColor Cyan
Write-Host "Inlined: 1 CSS + $scriptCount JS files" -ForegroundColor Cyan
Write-Host ""
Write-Host "Now you can share just this one HTML file!" -ForegroundColor Yellow
