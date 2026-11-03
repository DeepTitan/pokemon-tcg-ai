param([string]$TraceExe = 'src-tauri/target/debug/match-lens.exe')

$ErrorActionPreference = 'Stop'
$tracePath = (Resolve-Path $TraceExe).Path
$image = [IO.File]::ReadAllBytes($tracePath)
$peOffset = [BitConverter]::ToInt32($image, 0x3c)
$subsystem = [BitConverter]::ToUInt16($image, $peOffset + 92)
Write-Host "PE subsystem: $subsystem (2 = Windows GUI)"
if ($subsystem -ne 2) { throw 'Startup smoke test requires the production Windows GUI subsystem.' }

# MainWindowHandle selects Tauri's single-instance message window, which has
# WS_VISIBLE but zero dimensions and never appears on screen. Enumerate every
# window instead, and check visible windows with actual screen area. Opening
# Trace below is a positive control that this check detects the real UI.
Add-Type @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class TraceWindowProbe {
    public delegate bool EnumProc(IntPtr window, IntPtr param);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    public class Window { public IntPtr Handle; public string Title; public int Width, Height; }
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    public static Window[] VisibleWindows(int processId) {
        var windows = new List<Window>();
        EnumWindows((window, unused) => {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != processId || !IsWindowVisible(window)) return true;
            Rect rect;
            if (!GetWindowRect(window, out rect)) throw new Win32Exception();
            int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
            if (width <= 0 || height <= 0) return true;
            var title = new StringBuilder(512);
            GetWindowText(window, title, title.Capacity);
            windows.Add(new Window { Handle = window, Title = title.ToString(), Width = width, Height = height });
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }
}
'@

$recorder = Start-Process -FilePath $tracePath -ArgumentList '--trace-background' -PassThru
function Get-RecorderWindows {
    $recorder.Refresh()
    if ($recorder.HasExited) { throw "Background recorder exited ($($recorder.ExitCode))." }
    [TraceWindowProbe]::VisibleWindows($recorder.Id)
}
try {
    Start-Sleep -Seconds 12
    $windows = @(Get-RecorderWindows)
    if ($windows.Count) { throw "Background startup opened a window: $($windows | ConvertTo-Json -Compress)." }
    Write-Host "Background PID $($recorder.Id) is alive with no visible UI."

    # A normal second launch must open the existing recorder, and closing its
    # window must keep that same process alive. Repeat to verify recreation.
    foreach ($attempt in 1..2) {
        $activation = Start-Process -FilePath $tracePath -PassThru
        if (-not $activation.WaitForExit(15000)) { throw 'Second launch did not hand off to the recorder.' }
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        do {
            Start-Sleep -Milliseconds 500
            $windows = @(Get-RecorderWindows)
        } while (-not $windows.Count -and [DateTime]::UtcNow -lt $deadline)
        if ($windows.Count -ne 1 -or $windows[0].Title -ne 'Trace') {
            throw "Opening Trace did not create its window: $($windows | ConvertTo-Json -Compress)."
        }
        Write-Host "Open $attempt created Trace ($($windows[0].Width)x$($windows[0].Height)) in PID $($recorder.Id)."
        if (-not [TraceWindowProbe]::PostMessage($windows[0].Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
            throw 'Could not request window close.'
        }
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 500
            $windows = @(Get-RecorderWindows)
        } while ($windows.Count -and [DateTime]::UtcNow -lt $deadline)
        if ($windows.Count) { throw 'Trace window remained open after close request.' }
        Start-Sleep -Seconds 2
        $null = @(Get-RecorderWindows)
        Write-Host "Close $attempt removed the UI and kept recorder PID $($recorder.Id) alive."
    }
} finally {
    if (-not $recorder.HasExited) { Stop-Process -Id $recorder.Id -Force }
}
