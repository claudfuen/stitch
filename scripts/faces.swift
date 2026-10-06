// Face boxes in a still, as JSON: [{"x","y","w","h"}] from the top-left, as shares of the frame. Apple Vision.
//   swift scripts/faces.swift <image>
import AppKit
import Vision

guard CommandLine.arguments.count > 1, let img = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("usage: faces.swift <image>\n".data(using: .utf8)!); exit(1)
}
let req = VNDetectFaceRectanglesRequest()
try VNImageRequestHandler(cgImage: cg).perform([req])
let faces = (req.results ?? []).map { f -> [String: Double] in
  let b = f.boundingBox
  return ["x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height, "conf": Double(f.confidence)]
}
print(String(data: try JSONSerialization.data(withJSONObject: faces), encoding: .utf8)!)
