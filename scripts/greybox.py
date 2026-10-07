# Build a location's grey box from its floor plan and render every camera setup from it.
# The plan in data/project.json is the only source: walls from its size, boxes from its items, mannequins on its marks,
# one camera per setup (Super 35, the setup's lens, height, facing and tilt).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/greybox.py -- <plan.json> <out_dir> [setup ...]
#       [--glb room.glb] [--glb-only]
#
# `bun run stitch greybox <location>` writes the plan out, runs this and registers the renders on the board.
# `--glb` also exports the built room (every camera, plan item and mark, tagged with their plan ids as glTF extras) for
# the board's Rooms view, so the room you audit in the browser is the same scene the renders come from.
import json
import math
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
glb = argv[argv.index("--glb") + 1] if "--glb" in argv else None
render = "--glb-only" not in argv
argv = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--glb")]
plan = json.load(open(argv[0]))
out_dir = argv[1]
only = set(argv[2:])

SENSOR = 24.9
GREY = {
    "floor": (0.55, 0.55, 0.53), "wall": (0.70, 0.70, 0.68), "ceiling": (0.80, 0.80, 0.80),
    "window": (0.88, 0.90, 0.92), "door": (0.42, 0.42, 0.42), "counter": (0.35, 0.33, 0.31), "seats": (0.62, 0.58, 0.48),
    "furniture": (0.45, 0.43, 0.40), "prop": (0.50, 0.50, 0.50), "light": (1.0, 1.0, 1.0), "board": (0.12, 0.12, 0.12),
}
PEOPLE = {"henrick": (0.35, 0.42, 0.55), "founder": (0.62, 0.45, 0.30), "clerk": (0.50, 0.38, 0.52),
          "brock": (0.10, 0.50, 0.46), "kyle": (0.58, 0.70, 0.88), "gerald": (0.78, 0.70, 0.52), "audience": (0.62, 0.56, 0.58)}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
mats = {}


def mat(name, rgb):
    if name not in mats:
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*rgb, 1.0)  # what Workbench shows
        m.use_nodes = True  # what glTF exports
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
            bsdf.inputs["Roughness"].default_value = 0.9
        mats[name] = m
    return mats[name]


def box(name, cx, cy, z, w, d, h, rgb, rot=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, z + h / 2))
    o = bpy.context.object
    o.name = name
    o.scale = (w, d, h)
    o.rotation_euler = (0, 0, math.radians(-rot))
    o.data.materials.append(mat(name.split(":")[0], rgb))
    return o


W, D, H = plan["width"], plan["depth"], plan["height"]
T = 0.15
box("floor", W / 2, D / 2, -0.05, W, D, 0.05, GREY["floor"])
box("ceiling", W / 2, D / 2, H, W, D, 0.05, GREY["ceiling"])
box("wall:entrance", W / 2, -T / 2, 0, W + 2 * T, T, H, GREY["wall"])
box("wall:far", W / 2, D + T / 2, 0, W + 2 * T, T, H, GREY["wall"])
box("wall:left", -T / 2, D / 2, 0, T, D, H, GREY["wall"])
box("wall:right", W + T / 2, D / 2, 0, T, D, H, GREY["wall"])

def tag(before, **props):
    for name in set(bpy.data.objects.keys()) - before:
        for k, v in props.items():
            if v is not None:
                bpy.data.objects[name][k] = v


tag(set(), kind="room")
beat_objects = {}
# Marks with "stand_in": [beats] are built twice: seated, and standing for those beats (the audience on its feet).
variants = []
for it in plan["items"]:
    before_item = set(bpy.data.objects.keys())
    (x, y), (w, d, h), z, rot, kind = it["at"], it["size"], it.get("z", 0), it.get("rot", 0), it["kind"]
    rgb = GREY.get(kind, GREY["prop"])
    if kind == "seats":
        # A beam of shell chairs facing +y (before rotation): seat, back on the -y edge, and the beam.
        n = max(1, round(w / 0.52))
        pitch = w / n
        for k in range(n):
            sx = x - w / 2 + pitch * (k + 0.5)
            box(f"seats:{it['id']}:{k}", sx, y, 0.42, pitch * 0.9, d * 0.75, 0.05, rgb, rot)
            box(f"seats:{it['id']}:{k}:back", sx, y - d * 0.4, 0.45, pitch * 0.9, 0.05, h - 0.45, rgb, rot)
        box(f"beam:{it['id']}", x, y, 0.32, w, 0.08, 0.06, (0.15, 0.15, 0.15), rot)
        for lx in (x - w / 2 + 0.2, x + w / 2 - 0.2):
            box(f"leg:{it['id']}", lx, y, 0, 0.06, 0.45, 0.32, (0.15, 0.15, 0.15), rot)
    elif kind == "wall":
        # A wall along its width, cut by openings [offset, width, sill, height] measured from its left end.
        x0 = x - w / 2
        cursor = 0.0
        for k, (off, ow, sill, oh) in enumerate(sorted(it.get("openings", []))):
            if off > cursor:
                box(f"wall:{it['id']}:{k}", x0 + (cursor + off) / 2, y, z, off - cursor, d, h, GREY["wall"], rot)
            box(f"wall:{it['id']}:{k}:below", x0 + off + ow / 2, y, z, ow, d, sill, GREY["wall"], rot)
            box(f"wall:{it['id']}:{k}:above", x0 + off + ow / 2, y, sill + oh, ow, d, h - sill - oh, GREY["wall"], rot)
            cursor = off + ow
        if cursor < w:
            box(f"wall:{it['id']}:end", x0 + (cursor + w) / 2, y, z, w - cursor, d, h, GREY["wall"], rot)
    elif kind == "window":
        # A frame you can see through: four bars around the opening, on the thin axis of the footprint.
        bar = 0.05
        along_x = w >= d
        span = w if along_x else d
        for (dx, dz, sw, sh) in ((0, 0, span, bar), (0, h - bar, span, bar), (-span / 2 + bar / 2, 0, bar, h), (span / 2 - bar / 2, 0, bar, h)):
            if along_x:
                box(f"window:{it['id']}", x + dx, y, z + dz, sw, max(d, 0.04), sh, (0.3, 0.3, 0.3), rot)
            else:
                box(f"window:{it['id']}", x, y + dx, z + dz, max(w, 0.04), sw, sh, (0.3, 0.3, 0.3), rot)
        if not along_x:
            # Wall windows read as pale panes: daylight beyond.
            box(f"pane:{it['id']}", x + 0.03, y, z, 0.02, d, h, GREY["window"], rot)
    elif kind == "light":
        o = box(f"light:{it['id']}", x, y, z, w, d, h, rgb, rot)
        if "dead" in it["label"]:
            o.data.materials[0] = mat("light-dead", (0.3, 0.3, 0.3))
    else:
        box(f"{kind}:{it['id']}", x, y, z, w, d, h, rgb, rot)
    tag(before_item, item=it["id"], kind=kind, label=it["label"])
    if it.get("beat"):
        beat_objects.setdefault(it["beat"], []).extend(set(bpy.data.objects.keys()) - before_item)

expanded = []
for m in plan["marks"]:
    if m.get("stand_in"):
        expanded.append(({**m, "pose": "sit"}, ("hide", set(m["stand_in"]))))
        expanded.append(({**m, "pose": "stand"}, ("show", set(m["stand_in"]))))
    else:
        expanded.append((m, None))
for m, variant in expanded:
    before = set(bpy.data.objects.keys())
    x, y = m["at"]
    rgb = PEOPLE.get(m["who"], (0.58, 0.58, 0.58))
    sit = m["pose"] == "sit"
    f = math.radians(m["facing"])
    # Seated mannequins sit on the chair; the body leans a little back from the knees.
    body_h, body_z, head_z = (0.62, 0.45, 1.2) if sit else (1.35, 0.0, 1.58)
    lift = m.get("z", 0)
    body_z, head_z = body_z + lift, head_z + lift
    bpy.ops.mesh.primitive_cylinder_add(radius=0.19, depth=body_h, location=(x, y, body_z + body_h / 2))
    o = bpy.context.object
    o.name = f"person:{m['id']}"
    o.data.materials.append(mat(f"person-{m['who']}", rgb))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.115, location=(x, y, head_z))
    hd = bpy.context.object
    hd.name = f"head:{m['id']}"
    hd.data.materials.append(mat(f"person-{m['who']}", rgb))
    # Nose: shows which way the face points.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x + math.sin(f) * 0.11, y + math.cos(f) * 0.11, head_z - 0.01))
    n = bpy.context.object
    n.scale = (0.04, 0.04, 0.05)
    n.rotation_euler = (0, 0, -f)
    n.data.materials.append(mat(f"person-{m['who']}", rgb))
    if sit:
        # Thighs forward over the seat.
        box(f"legs:{m['id']}", x + math.sin(f) * 0.22, y + math.cos(f) * 0.22, 0.45 + lift, 0.32, 0.42, 0.14, rgb, m["facing"])
    if lift and m.get("platform", True):
        box(f"platform:{m['id']}", x, y, 0, 1.6, 1.4, lift, GREY["floor"])
    tag(before, mark=m["id"], who=m["who"], beat=m.get("beat"), pose=m["pose"])
    if m.get("beat"):
        beat_objects.setdefault(m["beat"], []).extend(set(bpy.data.objects.keys()) - before)
    if variant:
        variants.append((set(bpy.data.objects.keys()) - before, variant))

# Light: a soft daylight from the left windows plus a fill, so shapes read in Workbench.
scene.render.engine = "BLENDER_WORKBENCH"
shading = scene.display.shading
shading.light = "STUDIO"
shading.color_type = "MATERIAL"
shading.show_shadows = True
shading.show_cavity = True
shading.cavity_type = "WORLD"
shading.show_object_outline = False
scene.display.light_direction = (0.6, -0.2, 0.75)
scene.display.shadow_shift = 0.1
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"

cams = {}
for s in plan["setups"]:
    cam_data = bpy.data.cameras.new(f"cam-{s['id']}")
    cam_data.lens = s["lens"]
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.sensor_width = SENSOR
    cam_data.clip_start = 0.05
    cam = bpy.data.objects.new(f"cam-{s['id']}", cam_data)
    scene.collection.objects.link(cam)
    x, y = s["at"]
    cam.location = (x, y, s["height"])
    cam.rotation_euler = (math.radians(90 + s.get("tilt", 0)), 0, math.radians(-s["facing"]))
    cam["setup"] = s["id"]
    cam["beat"] = s.get("beat") or ""
    cams[s["id"]] = cam

if glb:
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_cameras=True, export_extras=True, export_apply=True, export_yup=True)
    print(f"exported {glb}")

for s in plan["setups"] if render else []:
    if only and s["id"] not in only:
        continue
    scene.camera = cams[s["id"]]
    for beat, names in beat_objects.items():
        for name in names:
            bpy.data.objects[name].hide_render = bool(s.get("beat")) and beat != s.get("beat")
    for names, (mode, beats) in variants:
        on = s.get("beat") in beats
        for name in names:
            bpy.data.objects[name].hide_render = on if mode == "hide" else not on
    scene.render.filepath = f"{out_dir}/{s['id']}.png"
    bpy.ops.render.render(write_still=True)
    print(f"rendered {s['id']} -> {scene.render.filepath}")
