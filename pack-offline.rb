#!/usr/bin/env ruby
# frozen_string_literal: true

dir = File.expand_path(__dir__)
html = File.read(File.join(dir, 'index.html'))
css = File.read(File.join(dir, 'style.css'))
pal = File.read(File.join(dir, 'mard221.js'))
app = File.read(File.join(dir, 'app.js'))
icon = File.read(File.join(dir, 'icon.svg')).strip
icon_uri = 'data:image/svg+xml;charset=utf-8,' + icon.gsub(/([^a-zA-Z0-9_.~-])/) { |c| format('%%%02X', c.ord) }

pal = pal.gsub('</', '<\\/')
app = app.gsub('</', '<\\/')

html.sub!(/<html lang="zh-CN">/, '<html lang="zh-CN" data-offline="1">')
html.sub!(%r{<link rel="manifest" href="manifest.json" />\n}, '')
html.gsub!(%r{href="icon.svg"}, "href=\"#{icon_uri}\"")
html.sub!(%r{<link rel="stylesheet" href="style.css" />}, "<style>\n#{css}\n</style>")
html.sub!(%r{<script src="mard221.js"></script>\s*<script src="app.js"></script>}, "<script>\n#{pal}\n#{app}\n</script>")
html.sub!(%r{<button type="button" class="ghost top-off" id="btnOffline">离线</button>\n}, '')

require 'base64'

out = File.join(dir, '像素风-离线.html')
File.write(out, html)
desk = File.join(Dir.home, 'Desktop', '像素风-离线.html')
File.write(desk, html)

b64 = Base64.encode64(html)
plist = <<~XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WebMainResource</key>
  <dict>
    <key>WebResourceData</key>
    <data>
#{b64.rstrip}
    </data>
    <key>WebResourceFrameName</key>
    <string></string>
    <key>WebResourceMIMEType</key>
    <string>text/html</string>
    <key>WebResourceTextEncodingName</key>
    <string>UTF-8</string>
    <key>WebResourceURL</key>
    <string>https://pixel-lab.local/index.html</string>
  </dict>
</dict>
</plist>
XML
xml_path = File.join(dir, '像素风.webarchive.xml')
archive = File.join(dir, '像素风.webarchive')
File.write(xml_path, plist)
ok = system('/usr/bin/plutil', '-convert', 'binary1', xml_path, '-o', archive)
raise 'plutil failed' unless ok
File.delete(xml_path)
desk_archive = File.join(Dir.home, 'Desktop', '像素风.webarchive')
File.write(desk_archive, File.binread(archive))

readme = <<~TXT
像素风 · 离线版（不用 Wi-Fi）

iPhone 打开 HTML 时，分享里经常没有 Safari。请改用下面任一方法。

方法一（优先）：隔空投送「像素风.webarchive」
1. 发给 iPhone。
2. 在「文件」里点它，一般会直接用 Safari 打开。
3. 若弹出打开方式，选 Safari。

方法二：用微信
1. 把「像素风-离线.html」发到「文件传输助手」。
2. 在微信里点开这个文件。
3. 用微信自带的页面就能选图、出图纸，不用 Safari。

方法三：用邮件
把「像素风-离线.html」发给自己，用手机邮箱点开附件。

方法四：装了 Chrome
在「文件」里点开 html，分享 → 用 Chrome 打开。

保存图纸
点「保存」或「分享」，存到照片或文件。

注意
图只在手机里处理，不会上传。
色号是 MARD 221 屏幕近似色，实物豆请以色卡为准。
TXT
File.write(File.join(Dir.home, 'Desktop', '像素风-离线说明.txt'), readme)
puts "wrote #{out} (#{File.size(out)} bytes)"
puts "wrote #{desk}"
puts "wrote #{archive} (#{File.size(archive)} bytes)"
puts "wrote #{desk_archive}"

