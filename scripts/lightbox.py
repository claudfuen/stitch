# A lit grey box: the floor plan's geometry in neutral greys, lit only by the plan's own light sources
# (items with a "light" block: area keys aimed at a point, point practicals with a visible glowing bulb).
# The render shows where light falls and where shadows go from every camera, so every plate inherits one lighting plan.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/lightbox.py -- <plan.json> <out_dir> [--marks] [--exposure -2.5] [setup ...]
#
# Light items in the plan carry a block: {"type": "area", "kelvin": 5200, "power": 1400, "size": [w, h], "aim": [x, y, z]}
# or {"type": "point", "kelvin": 2700, "power": 45, "radius": 0.05}. Materials use the real surfaces' albedo in grey, so light
# falls off the way it does in the room. Exposure -2.5 suits a low-key interior. Cycles on Metal: about 15 s a frame on an M5 Max.
import json
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
plan = json.load(open(argv[0]))
out_dir = argv[1]
rest = argv[2:]
with_marks = "--marks" in rest
exposure = float(rest[rest.index("--exposure") + 1]) if "--exposure" in rest else 0.0
only = {a for a in rest if not a.startswith("--") and not a.replace(".", "").replace("-", "").isdigit()}

SENSOR = 24.9
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
mats = {}


def kelvin_rgb(k):
    """Approximate blackbody colour (Tanner Helland), normalised to 0..1."""
    t = k / 100.0
    r = 255 if t <= 66 else 329.698727446 * ((t - 60) ** -0.1332047592)
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * ((t - 60) ** -0.0755148492)
    b = 255 if t >= 66 else (0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    return tuple(max(0.0, min(1.0, c / 255.0)) for c in (r, g, b))


def material(name, rgb, rough=0.7, emit=None):
    key = (name, rgb, rough, emit)
    if key in mats:
        return mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit[0], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit[1]
    mats[key] = m
    return m


def box(name, cx, cy, z, w, d, h, mat, rot=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, z + h / 2))
    o = bpy.context.object
    o.name = name
    o.scale = (w, d, h)
    o.rotation_euler = (0, 0, math.radians(-rot))
    o.data.materials.append(mat)
    return o


GREY = {
    # Albedos of the real materials, in grey: dark lacquer and charcoal make the light fall off as it does in his room.
    "floor": material("floor", (0.09, 0.09, 0.085), 0.55), "ceiling": material("ceiling", (0.25, 0.25, 0.25), 0.9),
    "wall": material("wall", (0.14, 0.14, 0.135), 0.8), "lacquer": material("lacquer", (0.13, 0.13, 0.125), 0.15),
    "charcoal": material("charcoal", (0.04, 0.04, 0.04), 0.9), "door": material("door", (0.01, 0.01, 0.01), 0.95),
    "window": material("window", (0.8, 0.8, 0.82), 0.9, ((0.85, 0.9, 1.0), 2.5)), "furniture": material("furniture", (0.10, 0.10, 0.10), 0.45),
    "prop": material("prop", (0.55, 0.55, 0.53), 0.7), "person": material("person", (0.45, 0.45, 0.47), 0.6),
}

W, D, H = plan["width"], plan["depth"], plan["height"]
T = 0.15
box("floor", W / 2, D / 2, -0.05, W, D, 0.05, GREY["floor"])
box("ceiling", W / 2, D / 2, H, W, D, 0.05, GREY["ceiling"])
for name, cx, cy, w, d in (("front", W / 2, -T / 2, W + 2 * T, T), ("back", W / 2, D + T / 2, W + 2 * T, T), ("left", -T / 2, D / 2, T, D), ("right", W + T / 2, D / 2, T, D)):
    box(f"shell:{name}", cx, cy, 0, w, d, H, GREY["wall"])

for it in plan["items"]:
    (x, y), (w, d, h), z, rot, kind = it["at"], it["size"], it.get("z", 0), it.get("rot", 0), it["kind"]
    label = it["label"].lower()
    if kind == "light":
        L = it.get("light")
        if not L:
            continue
        rgb = kelvin_rgb(L.get("kelvin", 3200))
        if L["type"] == "area":
            data = bpy.data.lights.new(it["id"], "AREA")
            data.shape = "RECTANGLE"
            data.size, data.size_y = L["size"][0], L["size"][1]
            data.energy = L["power"]
            data.color = rgb
            o = bpy.data.objects.new(it["id"], data)
            scene.collection.objects.link(o)
            o.location = (x, y, z + h / 2)
            aim = Vector(L.get("aim", [W / 2, D / 2, 1.2]))
            o.rotation_euler = (aim - o.location).to_track_quat("-Z", "Y").to_euler()
        else:
            data = bpy.data.lights.new(it["id"], "POINT")
            data.energy = L["power"]
            data.color = rgb
            data.shadow_soft_size = L.get("radius", 0.05)
            o = bpy.data.objects.new(it["id"], data)
            scene.collection.objects.link(o)
            o.location = (x, y, z + h / 2)
            # The visible bulb or shade, glowing.
            bpy.ops.mesh.primitive_uv_sphere_add(radius=max(0.04, min(w, d) / 2), location=(x, y, z + h / 2))
            g = bpy.context.object
            g.name = f"glow:{it['id']}"
            g.data.materials.append(material(f"glow-{it['id']}", rgb, 0.5, (rgb, 6.0)))
        continue
    if kind == "wall":
        mat = GREY["charcoal"] if "charcoal" in label else GREY["lacquer"] if "lacquer" in label else GREY["wall"]
    elif kind == "door":
        mat = GREY["door"]
    elif kind == "window":
        mat = GREY["window"]
    elif kind == "furniture":
        mat = GREY["furniture"]
    else:
        mat = GREY["prop"]
    box(f"{kind}:{it['id']}", x, y, z, w, d, h, mat, rot)

if with_marks:
    for m in plan["marks"]:
        if m["who"].lower().startswith("interviewer"):
            continue
        x, y = m["at"]
        sit = m["pose"] == "sit"
        f = math.radians(m["facing"])
        body_h, body_z, head_z = (0.62, 0.45, 1.2) if sit else (1.35, 0.0, 1.58)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.19, depth=body_h, location=(x, y, body_z + body_h / 2))
        bpy.context.object.data.materials.append(GREY["person"])
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.115, location=(x, y, head_z))
        bpy.context.object.data.materials.append(GREY["person"])
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x + math.sin(f) * 0.11, y + math.cos(f) * 0.11, head_z - 0.01))
        n = bpy.context.object
        n.scale = (0.04, 0.04, 0.05)
        n.rotation_euler = (0, 0, -f)
        n.data.materials.append(GREY["person"])

world = bpy.data.worlds.new("dark")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.01, 0.01, 0.012, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
scene.world = world

scene.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for dev in prefs.devices:
        dev.use = True
    scene.cycles.device = "GPU"
except Exception as e:  # CPU fallback
    print("GPU unavailable:", e)
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.view_settings.view_transform = "AgX"
scene.view_settings.exposure = exposure

for s in plan["setups"]:
    if only and s["id"] not in only:
        continue
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
    scene.camera = cam
    scene.render.filepath = f"{out_dir}/{s['id']}{'-blocking' if with_marks else ''}.png"
    bpy.ops.render.render(write_still=True)
    print(f"rendered {s['id']} -> {scene.render.filepath}")
