param([Parameter(Mandatory=$true)][int64]$Hwnd)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
if ($null -eq $root) { Write-Output 'NO_WINDOW'; exit 0 }

$condition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button
)
$buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
foreach ($button in $buttons) {
  $name = [string]$button.Current.Name
  if ($name -match 'camera') { Write-Output $name }
}
