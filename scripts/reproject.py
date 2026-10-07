# Camera projection: carry an approved plate from one camera of a room to another through the room's own geometry.
# The plate is projected from its camera onto the 3D room (the GLB `stitch room` exports, the same geometry the plates
# are rendered from) and the room is rendered through the other camera. Every wall, chair and door lands where the
# geometry puts it, which a paint pass from a reference cannot promise: given a plate from a nearby angle, the image
# model copies the reference's composition instead of reframing it. What the source camera never saw (behind a chair,
# outside its frame, a face turned away from it) comes out magenta, for a fill pass that touches only those pixels.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/reproject.py -- <room.glb> <plan.json> <from-setup>
#       <plate.jpg> <to-setup> <out.png> [--size 1920x1080] [--samples 16] [--graze 0.1]
#
# Surfaces the source camera saw nearly edge-on (cosine to its lens under --graze) are holes too: their few texels would be
# stretched into a smear. Writes <out.png> (the plate seen from the new camera, holes magenta) and <out>.holes.png (white where the source
# camera saw the surface). Cameras come from the plan (lens on Super 35, height, facing, tilt), as in greybox.py.
import math
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
flags = {argv[i]: argv[i + 1] for i in range(len(argv) - 1) if argv[i].startswith("--")}
glb, plan_file, src_id, plate, dst_id, out = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or not argv[i - 1].startswith("--"))][:6]
RW, RH = map(int, flags.get("--size", "1920x1080").split("x"))
SENSOR = 24.9

import json  # noqa: E402

plan = json.load(open(plan_file))
setups = {s["id"]: s for s in plan["setups"]}
src, dst = setups[src_id], setups[dst_id]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=glb)
# Only the room's surfaces: cameras, lights and empties from the export stay out of the render.
for o in list(scene.objects):
    if o.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in scene.objects if o.type == "MESH" and not o.name.startswith(("mark", "person", "head", "legs", "standin"))]
for o in scene.objects:
    if o.type == "MESH" and o not in meshes:
        o.hide_render = True
# Wild walls of the destination setup: the new camera sees through them, but they still hide what the source camera
# could not see (so they keep casting the visibility pass's shadows).
for o in meshes:
    if o.get("item") in set(dst.get("wild", [])):
        o.visible_camera = False


def axes(s):
    f, t = math.radians(s["facing"]), math.radians(s.get("tilt") or 0)
    fwd = Vector((math.sin(f) * math.cos(t), math.cos(f) * math.cos(t), math.sin(t)))
    right = Vector((math.cos(f), -math.sin(f), 0))
    up = right.cross(fwd)
    return Vector((s["at"][0], s["at"][1], s["height"])), fwd, right, up


def camera(s):
    data = bpy.data.cameras.new(f"cam-{s['id']}")
    data.lens, data.sensor_fit, data.sensor_width, data.clip_start = s["lens"], "HORIZONTAL", SENSOR, 0.05
    cam = bpy.data.objects.new(f"cam-{s['id']}", data)
    scene.collection.objects.link(cam)
    cam.location = (s["at"][0], s["at"][1], s["height"])
    cam.rotation_euler = (math.radians(90 + (s.get("tilt") or 0)), 0, math.radians(-s["facing"]))
    return cam


# The projection, per shading point: into the source camera's frame (pinhole, its lens on Super 35), then the plate.
pos, fwd, right, up = axes(src)
k = src["lens"] / SENSOR  # 1 / (2 tan(hfov / 2))
img = bpy.data.images.load(plate)
proj = bpy.data.materials.new("projected")
proj.use_nodes = True
nt = proj.node_tree
nt.nodes.clear()
N = nt.nodes.new
geo = N("ShaderNodeNewGeometry")
rel = N("ShaderNodeVectorMath"); rel.operation = "SUBTRACT"; rel.inputs[1].default_value = pos
nt.links.new(geo.outputs["Position"], rel.inputs[0])


def dot(vec):
    d = N("ShaderNodeVectorMath"); d.operation = "DOT_PRODUCT"; d.inputs[1].default_value = vec
    nt.links.new(rel.outputs[0], d.inputs[0])
    return d.outputs["Value"]


def screen(axis_out, depth_out, scale):
    q = N("ShaderNodeMath"); q.operation = "DIVIDE"
    nt.links.new(axis_out, q.inputs[0]); nt.links.new(depth_out, q.inputs[1])
    m = N("ShaderNodeMath"); m.operation = "MULTIPLY_ADD"; m.inputs[1].default_value = scale; m.inputs[2].default_value = 0.5
    nt.links.new(q.outputs[0], m.inputs[0])
    return m.outputs[0]


depth = dot(fwd)
uv = N("ShaderNodeCombineXYZ")
nt.links.new(screen(dot(right), depth, k), uv.inputs[0])
nt.links.new(screen(dot(up), depth, k * RW / RH), uv.inputs[1])
tex = N("ShaderNodeTexImage"); tex.image = img; tex.extension = "CLIP"; tex.interpolation = "Cubic"
nt.links.new(uv.outputs[0], tex.inputs["Vector"])
hole = N("ShaderNodeMix"); hole.data_type = "RGBA"; hole.inputs["B"].default_value = (1, 0, 1, 1)  # outside its frame
inv = N("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0
nt.links.new(tex.outputs["Alpha"], inv.inputs[1])
# A surface the source camera sees edge-on gets a few texels stretched across it: a smear the fill pass then "smooths"
# into the painterly look. Below GRAZE (cosine between the surface normal and the way to the source lens) it is a hole.
GRAZE = float(flags.get("--graze", "0.1"))
toward = N("ShaderNodeVectorMath"); toward.operation = "SUBTRACT"; toward.inputs[0].default_value = pos
nt.links.new(geo.outputs["Position"], toward.inputs[1])
unit = N("ShaderNodeVectorMath"); unit.operation = "NORMALIZE"
nt.links.new(toward.outputs[0], unit.inputs[0])
facing = N("ShaderNodeVectorMath"); facing.operation = "DOT_PRODUCT"
nt.links.new(unit.outputs[0], facing.inputs[0]); nt.links.new(geo.outputs["Normal"], facing.inputs[1])
absf = N("ShaderNodeMath"); absf.operation = "ABSOLUTE"
nt.links.new(facing.outputs["Value"], absf.inputs[0])
grazing = N("ShaderNodeMath"); grazing.operation = "LESS_THAN"; grazing.inputs[1].default_value = GRAZE
nt.links.new(absf.outputs[0], grazing.inputs[0])
either = N("ShaderNodeMath"); either.operation = "MAXIMUM"
nt.links.new(inv.outputs[0], either.inputs[0]); nt.links.new(grazing.outputs[0], either.inputs[1])
nt.links.new(either.outputs[0], hole.inputs["Factor"])
nt.links.new(tex.outputs["Color"], hole.inputs["A"])
em = N("ShaderNodeEmission")
nt.links.new(hole.outputs["Result"], em.inputs["Color"])
nt.links.new(em.outputs[0], N("ShaderNodeOutputMaterial").inputs["Surface"])

white = bpy.data.materials.new("seen")
white.use_nodes = True
bsdf = white.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
bsdf.inputs["Roughness"].default_value = 1.0


def assign(m):
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(m)
        for poly in o.data.polygons:
            poly.material_index = 0


scene.camera = camera(dst)
scene.render.engine = "CYCLES"
scene.cycles.device = "GPU"
scene.cycles.use_denoising = False
scene.render.resolution_x, scene.render.resolution_y = RW, RH
scene.view_settings.view_transform = "Standard"
scene.world = bpy.data.worlds.new("black")
scene.world.color = (0, 0, 0)

# Pass 1: the plate, carried through the geometry.
assign(proj)
scene.cycles.samples = int(flags.get("--samples", "16"))
scene.render.filepath = out
bpy.ops.render.render(write_still=True)

# Pass 2: what the source camera saw. A point light at its lens lights exactly the surfaces it can see; shadows are
# the surfaces hidden behind something nearer.
assign(white)
lamp = bpy.data.lights.new("seen-from", "POINT")
lamp.energy, lamp.shadow_soft_size = 200000, 0.0
lo = bpy.data.objects.new("seen-from", lamp)
scene.collection.objects.link(lo)
lo.location = pos
scene.cycles.samples = 4
scene.cycles.max_bounces = 0  # direct light only: a bounce off a white wall would light the shadows and hide the holes
holes = out.rsplit(".", 1)[0] + ".holes.png"
scene.render.filepath = holes
bpy.ops.render.render(write_still=True)

# Composite: magenta wherever the source camera never saw the surface.
a = bpy.data.images.load(out)
b = bpy.data.images.load(holes)
pa = np.array(a.pixels[:]).reshape(RH, RW, 4)
pb = np.array(b.pixels[:]).reshape(RH, RW, 4)
seen = pb[..., :3].max(axis=2) > 0.01
pa[~seen, :3] = (1.0, 0.0, 1.0)
pb[..., :3] = seen[..., None].astype(float)
a.pixels[:] = pa.ravel()
a.save()
b.pixels[:] = pb.ravel()
b.save()
print(f"reprojected {src_id} -> {dst_id}: {seen.mean() * 100:.1f}% of the frame seen by {src_id}; wrote {out}")
