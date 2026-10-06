// Person mask for a still: white where Apple Vision sees people, black elsewhere, at the image's own size.
//   swift scripts/personmask.swift <image> <mask.png> [index,index...]   (indices pick instances, 1-based; default all)
import AppKit
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count >= 3, let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("usage: personmask.swift <image> <mask.png> [1,2]\n".data(using: .utf8)!); exit(1)
}
let req = VNGeneratePersonInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: cg)
try handler.perform([req])
guard let obs = req.results?.first else { print("no people"); exit(2) }
var picked = obs.allInstances
if args.count > 3 { picked = IndexSet(args[3].split(separator: ",").compactMap { Int($0) }) }
print("instances: \(obs.allInstances.map { $0 }) using \(picked.map { $0 })")
let buf = try obs.generateScaledMaskForImage(forInstances: picked, from: handler)
let ci = CIImage(cvPixelBuffer: buf)
let ctx = CIContext()
let url = URL(fileURLWithPath: args[2])
try ctx.writePNGRepresentation(of: ci, to: url, format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())
print("wrote \(args[2]) \(cg.width)x\(cg.height)")
