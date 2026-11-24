import AppKit

// Render a simple text monogram. PNG/iconset/icns files are generated build outputs.
guard CommandLine.arguments.count == 2 else {
    fatalError("Usage: macos-icon.swift <output.iconset>")
}
let outputURL = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let size = points * scale
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size,
            pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
            isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
            let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
            fatalError("Cannot create macOS icon bitmap")
        }
        bitmap.size = NSSize(width: size, height: size)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        let canvas = NSRect(x: 0, y: 0, width: size, height: size)
        context.cgContext.clear(canvas)
        NSColor(srgbRed: 0.17, green: 0.19, blue: 0.22, alpha: 1).setFill()
        NSBezierPath(roundedRect: canvas.insetBy(dx: Double(size) * 0.05, dy: Double(size) * 0.05),
            xRadius: Double(size) * 0.19, yRadius: Double(size) * 0.19).fill()
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: Double(size) * 0.32, weight: .bold),
            .foregroundColor: NSColor.white,
        ]
        let text = "LQ" as NSString
        let extent = text.size(withAttributes: attributes)
        text.draw(at: NSPoint(x: (Double(size) - extent.width) / 2,
            y: (Double(size) - extent.height) / 2), withAttributes: attributes)
        NSGraphicsContext.restoreGraphicsState()
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            fatalError("Cannot encode macOS icon PNG")
        }
        let name = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
        try png.write(to: outputURL.appendingPathComponent(name))
    }
}
