[CmdletBinding()]
param([string]$ImagePath)

try {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    function Await($asyncOp, $type) {
        $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($asyncOp))
        $task.Wait()
        return $task.Result
    }

    [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
    [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
    [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

    $targetPath = $ImagePath

    if (Test-Path $ImagePath) {
        $bytes = [System.IO.File]::ReadAllBytes($ImagePath)
        # Verificar assinatura EMF (0x01 0x00 0x00 0x00 e ' EMF' a 0x28)
        if ($bytes.Length -ge 44 -and $bytes[0] -eq 1 -and $bytes[40] -eq 0x20 -and $bytes[41] -eq 0x45 -and $bytes[42] -eq 0x4D -and $bytes[43] -eq 0x46) {
            $metafile = New-Object System.Drawing.Imaging.Metafile($ImagePath)
            $w = [Math]::Max(600, [int]($metafile.Width * 2))
            $h = [Math]::Max(400, [int]($metafile.Height * 2))
            $bmp = New-Object System.Drawing.Bitmap($w, $h)
            $gfx = [System.Drawing.Graphics]::FromImage($bmp)
            $gfx.Clear([System.Drawing.Color]::White)
            $gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $gfx.DrawImage($metafile, 0, 0, $w, $h)
            $gfx.Dispose()
            $tempPng = [System.IO.Path]::ChangeExtension($ImagePath, ".rendered.png")
            $bmp.Save($tempPng, [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
            $metafile.Dispose()
            $targetPath = $tempPng
        }
    }

    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $engine) { exit 1 }

    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($targetPath)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    Write-Output "---OCR_START---"
    Write-Output $result.Text
    Write-Output "---OCR_END---"
} catch {
    Write-Output "OCR_ERROR: $($_.Exception.Message)"
}
