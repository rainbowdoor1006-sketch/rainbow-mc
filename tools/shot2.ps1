param([string]$Out = (Join-Path $env:TEMP 'rainbow_m1.png'))
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PW {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[PW]::SetProcessDPIAware() | Out-Null

$p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'RAINBOW MC' } | Select-Object -First 1
if (-not $p) { Write-Output 'window not found'; exit 1 }
$h = $p.MainWindowHandle

$r = New-Object PW+RECT
[PW]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$hh = $r.Bottom - $r.Top
if ($w -le 0 -or $hh -le 0) { Write-Output 'bad rect'; exit 1 }

$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [PW]::PrintWindow($h, $hdc, 2)
$g.ReleaseHdc($hdc)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output ("printwindow=" + $ok + " size=" + $w + "x" + $hh + " -> " + $Out)
