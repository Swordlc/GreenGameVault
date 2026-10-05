# PotStats 构建脚本
#
# 用系统自带 .NET Framework 4.8 的 csc.exe 编译 —— 零依赖、零安装。
# 目标机只要有 Windows（自带 .NET Framework 4.x）就能直接跑这个 exe，
# 不需要装 .NET SDK / 运行时，方便随 GreenGameVault 一起分发。
#
# 用法：powershell -File build.ps1
# 产物：bin/PotStats.exe

$ErrorActionPreference = 'Stop'

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) {
    throw '找不到 csc.exe，请确认已安装 .NET Framework 4.x'
}

$srcDir = Join-Path $PSScriptRoot 'src'
$sources = @(Get-ChildItem -Path $srcDir -Filter '*.cs' | Sort-Object Name | ForEach-Object { $_.FullName })
if ($sources.Count -eq 0) { throw "src 目录下没有 .cs 文件: $srcDir" }

$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir 'PotStats.exe'

# 清掉上次运行留下的日志 —— bin/ 整个目录会被 electron-builder 当 extraFiles
# 复制成发行包里的 potstats/，漏一份测试日志进去就不干净了
Get-ChildItem -Path $outDir -Filter '*.log' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

& $csc /nologo /target:exe /platform:x64 /optimize+ `
    /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
    /out:"$out" $sources

if ($LASTEXITCODE -ne 0) { throw "编译失败，csc 退出码 $LASTEXITCODE" }

"编译成功: $out"
"大小: {0:N0} 字节" -f (Get-Item $out).Length
