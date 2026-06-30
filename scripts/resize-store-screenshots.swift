import AppKit
import Foundation

let backgroundColor = NSColor(red: 0.961, green: 0.961, blue: 0.969, alpha: 1.0)
let canvasSize = NSSize(width: 1280, height: 800)

func loadImage(from path: String) -> NSImage? {
  NSImage(contentsOfFile: path)
}

func fitSize(for image: NSImage, in canvas: NSSize) -> NSSize {
  let widthRatio = canvas.width / image.size.width
  let heightRatio = canvas.height / image.size.height
  let scale = min(widthRatio, heightRatio)
  return NSSize(width: floor(image.size.width * scale), height: floor(image.size.height * scale))
}

func savePNG(_ image: NSImage, to path: String) throws {
  let width = Int(canvasSize.width)
  let height = Int(canvasSize.height)
  guard
    let bitmap = NSBitmapImageRep(
      bitmapDataPlanes: nil,
      pixelsWide: width,
      pixelsHigh: height,
      bitsPerSample: 8,
      samplesPerPixel: 4,
      hasAlpha: true,
      isPlanar: false,
      colorSpaceName: .deviceRGB,
      bytesPerRow: 0,
      bitsPerPixel: 0
    )
  else {
    throw NSError(domain: "resize-store-screenshots", code: 2)
  }

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
  backgroundColor.setFill()
  NSRect(origin: .zero, size: canvasSize).fill()
  NSGraphicsContext.current?.imageInterpolation = .high

  let fitted = fitSize(for: image, in: canvasSize)
  let x = floor((canvasSize.width - fitted.width) / 2)
  let y = floor((canvasSize.height - fitted.height) / 2)
  image.draw(
    in: NSRect(x: x, y: y, width: fitted.width, height: fitted.height),
    from: NSRect(origin: .zero, size: image.size),
    operation: .copy,
    fraction: 1.0
  )
  NSGraphicsContext.restoreGraphicsState()

  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw NSError(domain: "resize-store-screenshots", code: 3)
  }
  try data.write(to: URL(fileURLWithPath: path))
}

let args = CommandLine.arguments
guard args.count >= 2 else {
  fputs("Usage: resize-store-screenshots.swift <input.png> [output.png]\n", stderr)
  exit(1)
}

let inputPath = args[1]
let outputPath = args.count >= 3
  ? args[2]
  : inputPath.replacingOccurrences(of: ".png", with: "-1280x800.png")

guard let source = loadImage(from: inputPath) else {
  fputs("Could not load \(inputPath)\n", stderr)
  exit(1)
}

do {
  try savePNG(source, to: outputPath)
  print("Wrote \(outputPath)")
} catch {
  fputs("Failed to write \(outputPath): \(error)\n", stderr)
  exit(1)
}
