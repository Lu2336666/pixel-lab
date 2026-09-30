#!/usr/bin/env ruby
# frozen_string_literal: true
require 'zlib'

dir = File.expand_path(__dir__)
palette = [
  [0x0e, 0x0f, 0x14],
  [0x3d, 0xff, 0x8a],
  [0xff, 0xec, 0x27],
  [0xff, 0x4d, 0x8d],
  [0x29, 0xad, 0xff],
]

def chunk(type, data)
  type = type.to_s.b
  data = data.to_s.b
  [data.bytesize].pack('N') + type + data + [Zlib.crc32(type + data)].pack('N')
end

def write_png(path, size)
  scale = size / 16
  rows = []
  size.times do |y|
    row = [0]
    size.times do |x|
      gx, gy = x / scale, y / scale
      rgb = if gx.between?(2, 6) && gy.between?(2, 6)
              [0x3d, 0xff, 0x8a]
            elsif gx.between?(9, 13) && gy.between?(2, 6)
              [0xff, 0xec, 0x27]
            elsif gx.between?(2, 6) && gy.between?(9, 13)
              [0xff, 0x4d, 0x8d]
            elsif gx.between?(9, 13) && gy.between?(9, 13)
              [0x29, 0xad, 0xff]
            else
              [0x0e, 0x0f, 0x14]
            end
      row.concat(rgb)
      row << 255
    end
    rows.concat(row)
  end
  raw = rows.pack('C*')
  ihdr = [size, size, 8, 6, 0, 0, 0].pack('N2C5')
  png = [137, 80, 78, 71, 13, 10, 26, 10].pack('C*') + chunk('IHDR', ihdr) + chunk('IDAT', Zlib.deflate(raw, 9)) + chunk('IEND', '')
  File.binwrite(path, png)
  puts "#{path} #{File.size(path)}"
end

write_png(File.join(dir, 'icon-180.png'), 180)
write_png(File.join(dir, 'icon-192.png'), 192)
write_png(File.join(dir, 'icon-512.png'), 512)
