# Inline all CSS and JS into a single HTML file for easy sharing
# Usage: powershell -ExecutionPolicy Bypass -File inline-html.ps1

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$htmlFile = Join-Path $baseDir "app.html"
$outputFile = Join-Path $baseDir "monkeygtd-standalone.html"

Write-Host "Creating standalone HTML file..." -ForegroundColor Cyan

# Read original HTML
$html = [System.IO.File]::ReadAllText($htmlFile, [System.Text.Encoding]::UTF8)

# Extract CSS link and replace with inline style (before script processing to avoid conflicts)
$cssPattern = '<link rel="stylesheet" href="([^"]+)">'
$cssMatch = [regex]::Match($html, $cssPattern)
if ($cssMatch.Success) {
    $cssPath = $cssMatch.Groups[1].Value
    $cssFullPath = Join-Path $baseDir $cssPath
    if (Test-Path $cssFullPath) {
        $css = [System.IO.File]::ReadAllText($cssFullPath, [System.Text.Encoding]::UTF8)
        $styleTag = "<style>`r`n$css`r`n</style>"
        # Use literal string replacement instead of regex to avoid issues with special chars in CSS
        $html = $html.Replace($cssMatch.Value, $styleTag)
        Write-Host "Inlined CSS from $cssPath" -ForegroundColor Green
    } else {
        Write-Host "CSS file not found: $cssFullPath" -ForegroundColor Yellow
    }
}

# Extract all script tags (find positions using literal string search)
$scriptTags = @()
$scriptPattern = '<script src="'
$searchPos = 0
while ($searchPos -lt $html.Length) {
    $pos = $html.IndexOf($scriptPattern, $searchPos)
    if ($pos -eq -1) { break }
    
    $endPos = $html.IndexOf('"></script>', $pos)
    if ($endPos -eq -1) { break }
    
    $endPos += '"></script>'.Length
    $tag = $html.Substring($pos, $endPos - $pos)
    $scriptTags += @{ 'Tag' = $tag; 'Pos' = $pos; 'End' = $endPos }
    
    $searchPos = $endPos
}

# Load all JS files in order
$combinedJs = ""
$scriptCount = 0
$replacements = @()

foreach ($tagInfo in $scriptTags) {
    $tag = $tagInfo.Tag
    # Extract the src path from tag like: <script src="js/core/cqrs.js"></script>
    $srcStart = $tag.IndexOf('"') + 1
    $srcEnd = $tag.IndexOf('"', $srcStart)
    $scriptPath = $tag.Substring($srcStart, $srcEnd - $srcStart)
    $scriptFullPath = Join-Path $baseDir $scriptPath
    
    if (Test-Path $scriptFullPath) {
        $js = [System.IO.File]::ReadAllText($scriptFullPath, [System.Text.Encoding]::UTF8)
        $combinedJs += $js + "`r`n`r`n"
        $scriptCount++
        Write-Host "Inlined JS from $scriptPath" -ForegroundColor Green
        $replacements += $tag
    } else {
        Write-Host "JS file not found: $scriptFullPath" -ForegroundColor Yellow
    }
}

# Replace all script tags with single combined block (using literal replacement)
if ($replacements.Count -gt 0) {
    $singleScriptTag = "<script>`r`n$combinedJs`r`n</script>"
    
    # Replace the first tag with combined content
    $html = $html.Replace($replacements[0], $singleScriptTag)
    
    # Remove remaining tags
    for ($i = 1; $i -lt $replacements.Count; $i++) {
        $html = $html.Replace($replacements[$i], "")
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
