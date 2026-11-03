# Конвертирует Excel с маршрутами в data/routes.json
# Использование: powershell -File tools\xlsx-to-json.ps1 -Xlsx "C:\path\Маршруты.xlsx"
param(
  [Parameter(Mandatory = $true)][string]$Xlsx,
  [string]$Out
)
if (-not $Out) { $Out = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..\data\routes.json' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
$nsR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function Read-Entry($zip, $name) {
  $e = $zip.GetEntry($name)
  if (-not $e) { return $null }
  $r = New-Object IO.StreamReader($e.Open(), [Text.Encoding]::UTF8)
  try { [xml]$r.ReadToEnd() } finally { $r.Close() }
}

function Col-Index([string]$ref) {
  $letters = ($ref -replace '\d', '')
  $n = 0
  foreach ($ch in $letters.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }
  $n - 1
}

$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $Xlsx))
try {
  $shared = @()
  $sst = Read-Entry $zip 'xl/sharedStrings.xml'
  if ($sst) {
    $m = New-Object Xml.XmlNamespaceManager($sst.NameTable); $m.AddNamespace('x', $ns)
    foreach ($si in $sst.SelectNodes('//x:si', $m)) { $shared += $si.InnerText }
  }

  $wb = Read-Entry $zip 'xl/workbook.xml'
  $rels = Read-Entry $zip 'xl/_rels/workbook.xml.rels'
  $relMap = @{}
  foreach ($rel in $rels.DocumentElement.ChildNodes) { $relMap[$rel.Id] = $rel.Target }

  $wm = New-Object Xml.XmlNamespaceManager($wb.NameTable); $wm.AddNamespace('x', $ns)
  $routes = @()
  foreach ($sheet in $wb.SelectNodes('//x:sheet', $wm)) {
    $name = $sheet.GetAttribute('name')
    if ($name -notmatch '^Маршрут\s+(\d+)$') { continue }
    $routeNo = [int]$Matches[1]
    $target = $relMap[$sheet.GetAttribute('id', $nsR)] -replace '^/?xl/', ''
    $doc = Read-Entry $zip ("xl/" + $target)
    $sm = New-Object Xml.XmlNamespaceManager($doc.NameTable); $sm.AddNamespace('x', $ns)

    $points = @()
    $start = ''
    foreach ($row in $doc.SelectNodes('//x:sheetData/x:row', $sm)) {
      if ([int]$row.GetAttribute('r') -eq 1) { continue }
      $vals = @('', '', '', '', '')
      foreach ($c in $row.SelectNodes('x:c', $sm)) {
        $i = Col-Index $c.GetAttribute('r')
        if ($i -gt 4) { continue }
        $v = $c.SelectSingleNode('x:v', $sm)
        $is = $c.SelectSingleNode('x:is', $sm)
        $text = if ($c.GetAttribute('t') -eq 's' -and $v) { $shared[[int]$v.InnerText] }
                elseif ($is) { $is.InnerText }
                elseif ($v) { $v.InnerText } else { '' }
        $vals[$i] = "$text".Trim()
      }
      if (-not $vals[1] -and -not $vals[3]) { continue }
      if ($vals[4] -and -not $start) { $start = $vals[4] }
      $num = [int]$vals[0]
      $points += [ordered]@{
        id      = ('R{0}-{1:D3}' -f $routeNo, $num)
        n       = $num
        name    = $vals[1]
        type    = $vals[2]
        address = $vals[3]
      }
    }
    $routes += [ordered]@{ route = $routeNo; name = $name; start = $start; points = $points }
  }
} finally { $zip.Dispose() }

$routes = $routes | Sort-Object { $_.route }
$json = ConvertTo-Json -InputObject @{ generated = (Get-Date -Format 'yyyy-MM-dd'); routes = @($routes) } -Depth 6 -Compress
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Out), $json, (New-Object Text.UTF8Encoding($false)))
foreach ($r in $routes) { "{0}: {1} точек" -f $r.name, $r.points.Count }
"Всего: {0}" -f (($routes | ForEach-Object { $_.points.Count }) | Measure-Object -Sum).Sum
