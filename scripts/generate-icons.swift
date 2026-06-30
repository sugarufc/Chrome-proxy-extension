import AppKit
import Foundation

func loadImage(from path: String) -> NSImage? {
  NSImage(contentsOfFile: path)
}

func resize(_ image: NSImage, to size: CGFloat) -> NSImage {
  let newImage = NSImage(size: NSSize(width: size, height: size))
  newImage.lockFocus()
  NSGraphicsContext.current?.imageInterpolation = .high
  image.draw(
    in: NSRect(x: 0, y: 0, width: size, height: size),
    from: NSRect(origin: .zero, size: image.size),
    operation: .copy,
    fraction: 1.0
  )
  newImage.unlockFocus()
  return newImage
}

func addConnectedBadge(_ image: NSImage, size: CGFloat) -> NSImage {
  let badgeSize = max(4, size * 0.26)
  let margin = max(1, size * 0.03)
  let newImage = NSImage(size: NSSize(width: size, height: size))
  newImage.lockFocus()
  image.draw(
    in: NSRect(x: 0, y: 0, width: size, height: size),
    from: NSRect(origin: .zero, size: image.size),
    operation: .copy,
    fraction: 1.0
  )

  let rect = NSRect(
    x: size - badgeSize - margin,
    y: margin,
    width: badgeSize,
    height: badgeSize
  )
  NSColor(red: 0.08, green: 0.72, blue: 0.38, alpha: 1.0).setFill()
  NSBezierPath(ovalIn: rect).fill()

  NSColor.white.setStroke()
  let border = NSBezierPath(ovalIn: rect.insetBy(dx: 0.4, dy: 0.4))
  border.lineWidth = max(0.75, size * 0.045)
  border.stroke()

  newImage.unlockFocus()
  return newImage
}

func savePNG(_ image: NSImage, to path: String) throws {
  guard
    let tiff = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let data = bitmap.representation(using: .png, properties: [:])
  else {
    throw NSError(domain: "generate-icons", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to encode PNG"])
  }
  try data.write(to: URL(fileURLWithPath: path))
}

let args = CommandLine.arguments
guard args.count >= 3, let sourceImage = loadImage(from: args[1]) else {
  fputs("Usage: generate-icons.swift <source-image> <output-dir>\n", stderr)
  exit(1)
}

let outputDir = args[2]
for size in [16, 48, 128] {
  let dimension = CGFloat(size)
  let base = resize(sourceImage, to: dimension)
  do {
    try savePNG(base, to: "\(outputDir)/icon\(size).png")
    try savePNG(addConnectedBadge(base, size: dimension), to: "\(outputDir)/icon\(size)-on.png")
  } catch {
    fputs("Error writing icon\(size): \(error)\n", stderr)
    exit(1)
  }
}

print("Generated icons in \(outputDir)")
