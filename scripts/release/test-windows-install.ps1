param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$Version,
    [string]$OutputDirectory = 'artifacts/windows-first-install'
)

# Run only on a disposable hosted Windows runner. This exercises the shipped
# installer and UI with real certificate, routing, and sign-in registration.
# The runner is already elevated: this does not test the user's UAC dialog.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This test changes the disposable runner certificate store and hosts file; use a GitHub-hosted runner.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'The test runner must already be elevated.'
}
$installerPath = (Resolve-Path $Installer).Path
$installRoot = Join-Path $env:RUNNER_TEMP 'Trace first install'
$profileRoot = Join-Path $env:APPDATA 'com.isaiahw.matchlens'
$taskName = "Trace Background Recorder $($identity.User.Value)"
$hostsPath = Join-Path $env:SystemRoot 'System32/drivers/etc/hosts'
$originalHosts = [IO.File]::ReadAllBytes($hostsPath)
if ((Test-Path $installRoot) -or (Test-Path $profileRoot) -or
    (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
    throw 'First-install test requires a clean Trace install, profile, and startup task.'
}
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$outputRoot = (Resolve-Path $OutputDirectory).Path
$receipt = [ordered]@{
    version = $Version; sourceSha = $env:RELEASE_SHA
    installerSha256 = (Get-FileHash $installerPath -Algorithm SHA256).Hash
    elevatedRunner = $true; uacConsentTested = $false; realGameTested = $false
    passed = $false; checks = @()
}
$tracePath = $null
$recorder = $null
$certificate = $null
$oldBrowserArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
function Wait-Until([scriptblock]$Condition, [string]$Description, [int]$Seconds = 60) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        $result = & $Condition
        if ($result) { return $result }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out: $Description"
}
function Get-TraceWindow {
    if (-not $recorder) { return $null }
    $recorder.Refresh()
    if ($recorder.HasExited) { throw "Trace exited during setup ($($recorder.ExitCode))." }
    $condition = [Windows.Automation.AndCondition]::new(
        [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $recorder.Id),
        [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, 'Trace'))
    [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children, $condition)
}
function Find-Control([string]$Name, [switch]$Button) {
    $window = Get-TraceWindow
    if (-not $window) { return $null }
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, $Name)
    if ($Button) {
        $condition = [Windows.Automation.AndCondition]::new($condition,
            [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button))
    }
    $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
}
function Invoke-Button([string]$Name) {
    $button = Wait-Until { Find-Control $Name -Button } "button '$Name'"
    if (-not $button.Current.IsEnabled) { throw "Button '$Name' is disabled." }
    $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
}
function Save-UiEvidence([string]$Name) {
    $window = Get-TraceWindow
    if ($window) {
        $window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition) |
            ForEach-Object { "$($_.Current.ControlType.ProgrammaticName): $($_.Current.Name)" } |
            Set-Content (Join-Path $outputRoot "$Name-ui.txt")
    }
    $bounds = [Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = [Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($bounds.Location, [Drawing.Point]::Empty, $bounds.Size)
        $bitmap.Save((Join-Path $outputRoot "$Name.png"), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
function Assert-NoNotification {
    if (Find-Control 'Dismiss notification' -Button) { throw 'Unexpected first-install error notification.' }
}
function Assert-RouteReady([int]$OwnerId) {
    $null = Wait-Until {
        $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 443 -State Listen -ErrorAction SilentlyContinue |
            Where-Object OwningProcess -eq $OwnerId
        $listener -and ([IO.File]::ReadAllText($hostsPath) -match '(?m)^# Trace local capture begin ')
    } 'the recorder listener and managed game route'
}
function Assert-RouteClean {
    $null = Wait-Until {
        [IO.File]::ReadAllText($hostsPath) -notmatch '# (Trace|Match Lens) local capture begin'
    } 'the crash watchdog to remove its game route' 30
}
function Stop-TestRecorder {
    if ($recorder) {
        $recorder.Refresh()
        if (-not $recorder.HasExited) { Stop-Process -Id $recorder.Id -Force }
        $script:recorder = $null
    }
    Assert-RouteClean
}
function Check-Passed([string]$Name) {
    $receipt.checks += $Name
    Write-Host "PASS: $Name"
}

try {
    $installerSignature = Get-AuthenticodeSignature $installerPath
    if ($installerSignature.Status -ne 'Valid') { throw 'Installer publisher signature is not valid.' }
    $receipt.publisher = $installerSignature.SignerCertificate.Subject
    # NSIS /D must be last, and its value must not be quoted even with spaces.
    $install = Start-Process $installerPath -ArgumentList "/S /D=$installRoot" -PassThru
    if (-not $install.WaitForExit(120000)) { throw 'Windows installer did not finish.' }
    if ($install.ExitCode -ne 0) { throw "Windows installer exited $($install.ExitCode)." }
    $tracePath = Join-Path $installRoot 'match-lens.exe'
    if (-not (Test-Path $tracePath)) { throw 'Installer did not create the Trace executable.' }
    $signature = Get-AuthenticodeSignature $tracePath
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -ne $receipt.publisher) {
        throw 'Installed application does not have the trusted installer publisher.'
    }
    if ((Get-Item $tracePath).VersionInfo.ProductVersion -ne $Version) { throw 'Installed application version differs from the candidate.' }
    $receipt.applicationSha256 = (Get-FileHash $tracePath -Algorithm SHA256).Hash
    Check-Passed 'Signed NSIS installation in a path containing spaces'

    # Standard WebView2 accessibility switch, scoped to this test process. No
    # app-side fixture, mocked IPC, or test feature exists in the release binary.
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility=complete --remote-debugging-port=9222'
    $recorder = Start-Process $tracePath -PassThru
    $null = Wait-Until { Find-Control 'Set up Trace' -Button } 'fresh-install setup screen'
    Assert-NoNotification
    Save-UiEvidence 'first-launch'
    Invoke-Button 'Set up Trace'
    $null = Wait-Until {
        Assert-NoNotification
        if (Find-Control 'Try again' -Button) { throw 'The real first-install setup failed.' }
        Find-Control 'Done' -Button
    } 'real setup to finish' 90
    if (-not (Find-Control 'Trace is ready')) { throw 'Setup did not report readiness.' }
    Assert-RouteReady $recorder.Id
    Save-UiEvidence 'setup-ready'
    Check-Passed 'Real setup reaches ready without an error notification'

    $preferences = Get-Content (Join-Path $profileRoot 'background-recording.json') -Raw | ConvertFrom-Json
    if (-not $preferences.launchAtLogin -or -not $preferences.recordingEnabled) { throw 'Automatic recording was not persisted.' }
    $pem = Get-Content (Join-Path $profileRoot 'capture/match-lens-ca.pem') -Raw
    $der = [Convert]::FromBase64String(($pem -replace '-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s', ''))
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($der)
    if (-not (Test-Path "Cert:/LocalMachine/Root/$($certificate.Thumbprint)")) { throw 'The exact local recording certificate was not installed.' }
    $task = Get-ScheduledTask -TaskName $taskName
    if ($task.Actions.Execute -ne $tracePath -or $task.Actions.Arguments -ne '--trace-background' -or
        $task.Principal.RunLevel -ne 'Highest' -or $task.Principal.LogonType -ne 'Interactive') {
        throw 'Sign-in startup does not target the installed background recorder with the right permissions.'
    }
    Check-Passed 'Certificate trust, saved preferences, and elevated per-user startup'
    Invoke-Button 'Done'
    $null = Wait-Until { -not (Find-Control 'Done' -Button) } 'setup dialog to close'
    Assert-NoNotification
    Save-UiEvidence 'archive-ready'
    Stop-TestRecorder
    Check-Passed 'Crash watchdog removes the game route'

    & "$PSScriptRoot/test-windows-background.ps1" -TraceExe $tracePath
    Assert-RouteClean
    Check-Passed 'Installed recorder stays alive across two window close/reopen cycles'

    Start-ScheduledTask -TaskName $taskName
    $recorder = Wait-Until {
        Get-Process -Name 'match-lens' -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -eq $tracePath -and (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -notmatch '--trace-route-' } |
            Select-Object -First 1
    } 'registered sign-in task to launch Trace'
    Assert-RouteReady $recorder.Id
    if (@([TraceWindowProbe]::VisibleWindows($recorder.Id)).Count) { throw 'Sign-in task unexpectedly opened a window.' }
    Check-Passed 'Registered Windows task starts recording without a window'
    Stop-TestRecorder

    $uninstaller = Get-ChildItem $installRoot -File -Filter '*uninstall*.exe' | Select-Object -First 1
    if (-not $uninstaller) { throw 'Installed uninstaller was not found.' }
    $uninstall = Start-Process $uninstaller.FullName -ArgumentList '/S' -PassThru
    if (-not $uninstall.WaitForExit(120000)) { throw 'Uninstaller did not finish.' }
    $null = Wait-Until { -not (Test-Path $tracePath) } 'installed executable to be removed'
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Uninstall left the startup task behind.' }
    Assert-RouteClean
    Check-Passed 'Uninstall removes the installed app, startup task, and game route'
    $receipt.passed = $true
} catch {
    $receipt.error = $_.Exception.Message
    try {
        & node "$PSScriptRoot/read-windows-setup-diagnostics.mjs" (Join-Path $outputRoot 'native-status.json')
        Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
            Where-Object LocalPort -in @(80, 443) |
            Select-Object LocalAddress, LocalPort, OwningProcess, @{Name='Process';Expression={(Get-Process -Id $_.OwningProcess).ProcessName}} |
            ConvertTo-Json | Set-Content (Join-Path $outputRoot 'listener-status.json')
    } catch { Write-Warning "Could not save native diagnostics: $_" }
    try { Save-UiEvidence 'failure' } catch { Write-Warning "Could not save UI evidence: $_" }
    throw
} finally {
    $receipt | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $outputRoot 'verification.json')
    # Copy only diagnostics, never device credentials, private keys, or profile data.
    Get-ChildItem (Join-Path $profileRoot 'capture') -Filter '*errors.log' -ErrorAction SilentlyContinue |
        Copy-Item -Destination $outputRoot
    $routeEvents = Join-Path $profileRoot 'capture/capture-route-events.jsonl'
    if (Test-Path $routeEvents) { Copy-Item $routeEvents -Destination $outputRoot }
    if ($recorder) {
        $recorder.Refresh()
        if (-not $recorder.HasExited) { Stop-Process -Id $recorder.Id -Force }
    }
    if ($tracePath -and (Test-Path $tracePath)) {
        $cleanup = Start-Process $tracePath -ArgumentList '--trace-uninstall-background' -PassThru
        $null = $cleanup.WaitForExit(15000)
        $cleanup = Start-Process $tracePath -ArgumentList '--trace-route-cleanup' -PassThru
        $null = $cleanup.WaitForExit(15000)
    }
    [IO.File]::WriteAllBytes($hostsPath, $originalHosts)
    if ($certificate) { Remove-Item "Cert:/LocalMachine/Root/$($certificate.Thumbprint)" -ErrorAction SilentlyContinue }
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $oldBrowserArguments
}
