#!/usr/bin/env ruby
require 'webrick'
require 'socket'

dir = File.expand_path(__dir__)
port = (ENV['PORT'] || '8780').to_i
stamp_path = File.join(dir, 'reload-stamp.txt')
lan_path = File.join(dir, 'lan.txt')
watch_names = %w[index.html style.css app.js mard221.js manifest.json sw.js]
watch_paths = watch_names.map { |f| File.join(dir, f) }

write_stamp = lambda do
  File.write(stamp_path, "#{Time.now.to_i}#{format('%09d', Time.now.nsec)}\n")
end
write_stamp.call

lan_ip = Socket.ip_address_list.find { |a| a.ipv4? && !a.ipv4_loopback? }
ip = lan_ip ? lan_ip.ip_address : '127.0.0.1'
File.write(lan_path, "#{ip}\n")

mtimes = {}
watch_paths.each { |p| mtimes[p] = File.mtime(p).to_f rescue 0 }
Thread.new do
  loop do
    sleep 0.4
    changed = false
    watch_paths.each do |p|
      t = File.mtime(p).to_f rescue 0
      next if t == mtimes[p]
      mtimes[p] = t
      changed = true
    end
    write_stamp.call if changed
  end
end

begin
  server = WEBrick::HTTPServer.new(
    Port: port,
    DocumentRoot: dir,
    BindAddress: '0.0.0.0',
    AccessLog: [],
    Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN)
  )
rescue Errno::EADDRINUSE
  warn "pixel-lab already serving on #{port}"
  loop { sleep 3600 }
end
trap('INT') { server.shutdown }
trap('TERM') { server.shutdown }
warn "像素风  电脑 http://127.0.0.1:#{port}/"
warn "像素风  手机 http://#{ip}:#{port}/   （同一 Wi-Fi）"
server.start
