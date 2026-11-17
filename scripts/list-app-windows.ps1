Add-Type -AssemblyName UIAutomationClient
$ids = (Get-Process plume-pdf).Id
$root = [System.Windows.Automation.AutomationElement]::RootElement
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $all) { if ($ids -contains $w.Current.ProcessId) {
  $texts = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)))
  "WINDOW: " + $w.Current.Name + " | " + (($texts | ForEach-Object { $_.Current.Name }) -join " / ")
  if ($w.Current.Name -eq "Open link") { $btn = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "No")))
    if ($btn) { $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); "clicked No" } }
} }
