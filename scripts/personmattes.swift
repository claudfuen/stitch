// Person mattes for a folder of frames: every PNG in <in> gets a same-size grey mask in <out>, white where Apple Vision
// sees people (person segmentation, accurate quality). Used by scripts/lockplate.py; about 12 frames a second.
//   swiftc -O scripts/personmattes.swift -o work/bin/personmattes && work/bin/personmattes <in> <out>
import AppKit
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count == 3 else { FileHandle.standardError.write("usage: personmattes <in_dir> <out_dir>\n".data(using: .utf8)!); exit(1) }
let inDir = URL(fileURLWithPath: args[1]), outDir = URL(fileURLWithPath: args[2])
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let files = try FileManager.default.contentsOfDirectory(at: inDir, includingPropertiesForKeys: nil).filter { $0.pathExtension == "png" }.sorted { $0.path < $1.path }
let ctx = CIContext()
for f in files {
    guard let src = CIImage(contentsOf: f) else { continue }
    let req = VNGeneratePersonSegmentationRequest()
    req.qualityLevel = .accurate
    req.outputPixelFormat = kCVPixelFormatType_OneComponent8
    try VNImageRequestHandler(ciImage: src, options: [:]).perform([req])
    var m = CIImage(color: .black).cropped(to: src.extent)
    if let buf = req.results?.first?.pixelBuffer {
        let raw = CIImage(cvPixelBuffer: buf)
        m = raw.transformed(by: CGAffineTransform(scaleX: src.extent.width / raw.extent.width, y: src.extent.height / raw.extent.height)).cropped(to: src.extent)
    }
    try ctx.writePNGRepresentation(of: m, to: outDir.appendingPathComponent(f.lastPathComponent), format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())
}
print("mattes: \(files.count)")
