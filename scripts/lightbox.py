# A lit grey box: the floor plan's geometry in neutral greys, lit only by the plan's own light sources. The render shows where
# light falls and where shadows go from every camera, so every plate inherits one lighting plan.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/lightbox.py -- <plan.json> <out_dir>
#       [--marks] [--ids] [--exposure -2.5] [--size 1920x1080] [--samples 96] [--glb room.glb [--glb-only]] [--top plot.png] [setup ...]
#
# Light items carry a block:
#   {"type": "area", "kelvin": 5600, "power": 1400, "size": [w, h], "aim": [x, y, z]}   a window or another soft source
#   {"type": "point", "kelvin": 2700, "power": 45, "radius": 0.05}                     a bulb or a shaded practical (it glows)
#   {"type": "panel", "kelvin": 4000, "strength": 4}                                    a lit surface: a lightbox, a backlit print
# Materials use the real surfaces' albedo in grey, so light falls off as it does in the room. Exposure -2.5 suits a low-key
# interior (-3.5 when a daylight window is close). Cycles on Metal takes about 15 s a frame on an M5 Max. Chairs (furniture
# labelled "chair") get a seat, arms and a back behind the sitter; `rot` is the way the sitter faces.
#
# --marks puts grey stand-ins on the marks of each setup's beat (a nose shows which way each one faces).
# --ids also writes <setup>.vis.json: every plan item and mark the camera sees, its share of the frame and where it sits, what
# is just outside the frame, what is behind the camera, which side each light comes from and which way each person looks
# on screen. It comes from a flat colour pass, so it accounts for occlusion. Write briefs from it, never from memory: a
# hand-written brief once put the reverse angle's window and doorway on the wrong sides.
#
# --glb writes the built room as one GLB before rendering (--glb-only skips the renders), for the Rooms viewer: every setup
# as a camera named by its id, point lights as glTF punctual lights, and extras on every node: {"item", "kind", "label"} on
# the set, {"light": {...}} on an empty per light (the plan's light block, since glTF has no area lights), {"mark", "who",
# "beat"} on each stand-in and its parent empty, {"setup", "name", "lens", "beat"} on each camera. glTF is y-up.
#
# --top renders the lighting plot: the room from straight above with the ceiling off, lit only by the plan's lights, every
# mark on set. The far wall is at the top. Scale: the image height covers the depth plus 1 m; the room's centre is the
# image centre, so pixel = centre + (x - W/2, D/2 - y) * height / (D + 1).
import json
import math
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
plan = json.load(open(argv[0]))
out_dir = argv[1]
rest = argv[2:]
VALUED = {"--exposure", "--size", "--samples", "--glb", "--top"}
flags, only = {}, set()
i = 0
while i < len(rest):
    a = rest[i]
    if a in VALUED:
        flags[a] = rest[i + 1]
        i += 2
        continue
    if a.startswith("--"):
        flags[a] = True
    else:
        only.add(a)
    i += 1
with_marks = "--marks" in flags
with_ids = "--ids" in flags
exposure = float(flags.get("--exposure", 0.0))
res_x, res_y = (int(v) for v in str(flags.get("--size", "1920x1080")).split("x"))
samples = int(flags.get("--samples", 96))
glb = flags.get("--glb")

SENSOR = 24.9
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
mats = {}
owner = {}  # object name -> plan key (item id, "mark:<id>", "wall:<side>", "floor", "ceiling")


def kelvin_rgb(k):
    """Approximate blackbody colour (Tanner Helland), normalised to 0..1."""
    t = k / 100.0
    r = 255 if t <= 66 else 329.698727446 * ((t - 60) ** -0.1332047592)
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * ((t - 60) ** -0.0755148492)
    b = 255 if t >= 66 else (0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    return tuple(max(0.0, min(1.0, c / 255.0)) for c in (r, g, b))


def material(name, rgb, rough=0.7, emit=None, metal=0.0):
    key = (name, rgb, rough, emit, metal)
    if key in mats:
        return mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit[0], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit[1]
    mats[key] = m
    return m


def box(name, key, cx, cy, z, w, d, h, mat, rot=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, z + h / 2))
    o = bpy.context.object
    o.name = name
    o.scale = (w, d, h)
    o.rotation_euler = (0, 0, math.radians(-rot))
    o.data.materials.append(mat)
    owner[o.name] = key
    o["item"] = key
    return o


GREY = {
    # Albedos of the real materials, in grey: dark lacquer and charcoal make the light fall off as it does in his room.
    "floor": material("floor", (0.09, 0.09, 0.085), 0.55), "ceiling": material("ceiling", (0.25, 0.25, 0.25), 0.9),
    "wall": material("wall", (0.14, 0.14, 0.135), 0.8), "lacquer": material("lacquer", (0.07, 0.07, 0.068), 0.15),
    "charcoal": material("charcoal", (0.04, 0.04, 0.04), 0.9), "door": material("door", (0.01, 0.01, 0.01), 0.95),
    "window": material("window", (0.8, 0.8, 0.82), 0.9, ((0.85, 0.9, 1.0), 2.5)), "furniture": material("furniture", (0.10, 0.10, 0.10), 0.45),
    "prop": material("prop", (0.55, 0.55, 0.53), 0.7), "person": material("person", (0.45, 0.45, 0.47), 0.6),
    "glass": material("glass", (0.02, 0.02, 0.022), 0.04),
}


def chair(it, mat):
    """An armchair facing `rot` (the sitter's heading): seat, back behind the sitter, two arms. Wing chairs get a taller back."""
    (x, y), (w, d, h), rot = it["at"], it["size"], it.get("rot", 0)
    f = math.radians(rot)
    fwd, right = (math.sin(f), math.cos(f)), (math.cos(f), -math.sin(f))
    seat_h, arm_h, back_t = 0.45, 0.62, 0.16

    def part(n, lx, ly, pw, pd, z0, ph):
        box(f"furniture:{it['id']}:{n}", it["id"], x + lx * right[0] + ly * fwd[0], y + lx * right[1] + ly * fwd[1], z0, pw, pd, ph, mat, rot)

    part("seat", 0, 0.04, w, d - back_t, 0, seat_h)
    part("back", 0, -(d - back_t) / 2, w, back_t, 0, h)
    part("arm-l", -(w - 0.12) / 2, 0.04, 0.12, d - back_t, 0, arm_h)
    part("arm-r", (w - 0.12) / 2, 0.04, 0.12, d - back_t, 0, arm_h)

W, D, H = plan["width"], plan["depth"], plan["height"]
T = 0.15
box("floor", "floor", W / 2, D / 2, -0.05, W, D, 0.05, GREY["floor"])
box("ceiling", "ceiling", W / 2, D / 2, H, W, D, 0.05, GREY["ceiling"])
for side, cx, cy, w, d in (("front", W / 2, -T / 2, W + 2 * T, T), ("back", W / 2, D + T / 2, W + 2 * T, T), ("left", -T / 2, D / 2, T, D), ("right", W + T / 2, D / 2, T, D)):
    box(f"shell:{side}", f"wall:{side}", cx, cy, 0, w, d, H, GREY["wall"])

lights = []  # (item, light object) for the side report
for it in plan["items"]:
    (x, y), (w, d, h), z, rot, kind = it["at"], it["size"], it.get("z", 0), it.get("rot", 0), it["kind"]
    label = it["label"].lower()
    if kind == "light":
        L = it.get("light")
        if not L:
            continue
        rgb = kelvin_rgb(L.get("kelvin", 3200))
        if L["type"] == "panel":
            # A lit surface: the item's own box, glowing.
            box(f"panel:{it['id']}", it["id"], x, y, z, w, d, h, material(f"panel-{it['id']}", rgb, 0.8, (rgb, L.get("strength", 4.0))), rot)
            lights.append((it, None))
            continue
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
            owner[g.name] = it["id"]
        lights.append((it, o))
        continue
    if kind == "wall":
        mat = GREY["charcoal"] if "charcoal" in label else GREY["lacquer"] if "lacquer" in label else GREY["wall"]
    elif kind == "door":
        mat = GREY["door"]
    elif kind == "window":
        mat = GREY["window"]
    elif kind == "furniture":
        mat = GREY["glass"] if "glass" in label else GREY["furniture"]
        if "chair" in label:
            chair(it, mat)
            continue
    else:
        mat = GREY["prop"]
    box(f"{kind}:{it['id']}", it["id"], x, y, z, w, d, h, mat, rot)

# The plan's own words on every set piece, and an empty per light carrying its light block (glTF has no area lights).
labels = {it["id"]: it for it in plan["items"]}
for o in list(scene.objects):
    it = labels.get(o.get("item", ""))
    if it:
        o["kind"], o["label"] = it["kind"], it["label"]
for it, lamp in lights:
    e = bpy.data.objects.new(f"light:{it['id']}", None)
    scene.collection.objects.link(e)
    e.location = lamp.location if lamp else Vector((it["at"][0], it["at"][1], it.get("z", 0) + it["size"][2] / 2))
    if lamp:
        e.rotation_euler = lamp.rotation_euler
    e["item"], e["label"], e["light"] = it["id"], it["label"], {k: v for k, v in it["light"].items()}

# Stand-ins for every mark except the off-camera interviewer; each setup shows only the marks of its beat.
stand_ins = {}
for m in plan["marks"]:
    if m["who"].lower().startswith("interviewer"):
        continue
    x, y = m["at"]
    base = m.get("z", 0)
    sit = m["pose"] == "sit"
    f = math.radians(m["facing"])
    body_h, body_z, head_z = (0.62, 0.45, 1.2) if sit else (1.35, 0.0, 1.58)
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(radius=0.19, depth=body_h, location=(x, y, base + body_z + body_h / 2))
    parts.append(bpy.context.object)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.115, location=(x, y, base + head_z))
    parts.append(bpy.context.object)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x + math.sin(f) * 0.11, y + math.cos(f) * 0.11, base + head_z - 0.01))
    nose = bpy.context.object
    nose.scale = (0.04, 0.04, 0.05)
    nose.rotation_euler = (0, 0, -f)
    parts.append(nose)
    root = bpy.data.objects.new(f"mark:{m['id']}", None)
    scene.collection.objects.link(root)
    root.location = (x, y, base)
    props = {"mark": m["id"], "who": m["who"], "beat": m.get("beat", "")}
    for k, val in props.items():
        root[k] = val
    for n, o in enumerate(parts):
        o.name = f"mark:{m['id']}:{n}"
        o.data.materials.append(GREY["person"])
        owner[o.name] = f"mark:{m['id']}"
        for k, val in props.items():
            o[k] = val
        o.parent = root
        o.matrix_parent_inverse = root.matrix_basis.inverted()  # matrix_world is stale until the depsgraph updates
    stand_ins[m["id"]] = parts

world = bpy.data.worlds.new("dark")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.01, 0.01, 0.012, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
world.color = (0, 0, 0)
scene.world = world

try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for dev in prefs.devices:
        dev.use = True
    GPU = True
except Exception as e:  # CPU fallback
    print("GPU unavailable:", e)
    GPU = False


def cycles():
    scene.render.engine = "CYCLES"
    if GPU:
        scene.cycles.device = "GPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = res_x, res_y
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = exposure


# ---- the flat colour pass behind --ids ------------------------------------------------------------------------------
def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


palette = {}  # key -> 8-bit sRGB colour
keys = sorted(set(owner.values()))
for n, key in enumerate(keys):
    palette[key] = (30 + (n % 6) * 42, 30 + ((n // 6) % 6) * 42, 40 + (n // 36) * 70)
for name, key in owner.items():
    bpy.data.objects[name].color = (*[srgb_to_linear(c / 255) for c in palette[key]], 1.0)
PAL_KEYS = list(palette)
PAL = np.array([palette[k] for k in PAL_KEYS], dtype=np.float32)


def id_pass(cam, setup, on_set):
    w, h = 480, round(480 * res_y / res_x)
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light, sh.color_type = "FLAT", "OBJECT"
    sh.show_shadows = sh.show_cavity = sh.show_object_outline = sh.show_specular_highlight = False
    scene.display.render_aa = "OFF"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0
    scene.render.resolution_x, scene.render.resolution_y = w, h
    path = f"{out_dir}/{setup['id']}.ids.png"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color"
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1, :, :3] * 255
    bpy.data.images.remove(img)
    flat = px.reshape(-1, 3)
    dist = ((flat[:, None, :] - PAL[None, :, :]) ** 2).sum(-1)
    near = dist.argmin(1)
    ok = dist[np.arange(len(near)), near] < 30 ** 2
    near = np.where(ok, near, -1).reshape(h, w)
    seen = {}
    for k_i, key in enumerate(PAL_KEYS):
        ys, xs = np.nonzero(near == k_i)
        if len(xs):
            seen[key] = {"share": round(len(xs) / (w * h), 4), "box": [round(xs.min() / w, 3), round(ys.min() / h, 3), round((xs.max() + 1) / w, 3), round((ys.max() + 1) / h, 3)],
                         "cx": round(float(xs.mean()) / w, 3), "cy": round(float(ys.mean()) / h, 3)}
    return seen


def where(cx, cy):
    hpos = "far left" if cx < 0.15 else "left" if cx < 0.38 else "centre" if cx <= 0.62 else "right" if cx <= 0.85 else "far right"
    vpos = "top" if cy < 0.33 else "middle" if cy <= 0.67 else "bottom"
    return f"{hpos}, {vpos}"


def report(setup, seen, on_set):
    """Plan-based visibility for one camera: in frame (with occlusion), at the edges, behind; light sides; eyelines."""
    cx, cy = setup["at"]
    f = math.radians(setup["facing"])
    fwd, right = (math.sin(f), math.cos(f)), (math.cos(f), -math.sin(f))
    half = math.degrees(math.atan(SENSOR / 2 / setup["lens"]))

    def angle(p):
        dx, dy = p[0] - cx, p[1] - cy
        a, b = dx * fwd[0] + dy * fwd[1], dx * right[0] + dy * right[1]
        return math.degrees(math.atan2(b, a)), math.hypot(dx, dy)

    # Area lights have no body of their own (their window or panel item stands for them).
    things = [(it["id"], it["label"], it["kind"], it["at"]) for it in plan["items"] if not (it.get("light") and it["light"]["type"] == "area")]
    things += [(f"mark:{m['id']}", f"{m['who'].capitalize()} (stand-in)", "person", m["at"]) for m in plan["marks"] if m["id"] in on_set]
    visible, edges, behind, hidden = [], [], [], []
    for key, label, kind, at in things:
        deg, dist = angle(at)
        s = seen.get(key)
        if s and s["share"] >= 0.0005:
            visible.append({"id": key, "label": label, "kind": kind, "share": s["share"], "box": s["box"], "where": where(s["cx"], s["cy"]), "dist": round(dist, 2)})
        elif abs(deg) > 90:
            behind.append({"id": key, "label": label, "kind": kind})
        elif abs(deg) <= half:
            hidden.append({"id": key, "label": label, "kind": kind, "note": "in the frustum but hidden behind something nearer"})
        elif abs(deg) <= half + 20:
            edges.append({"id": key, "label": label, "kind": kind, "side": "left" if deg < 0 else "right", "beyond_edge_deg": round(abs(deg) - half, 1)})
        else:
            behind.append({"id": key, "label": label, "kind": kind, "note": f"out of frame {'left' if deg < 0 else 'right'}"})
    walls = {k.split(":")[1]: v["share"] for k, v in seen.items() if k.startswith("wall:")}
    light_sides = []
    for it, _ in lights:
        deg, dist = angle(it["at"])
        inside = it["id"] in seen and seen[it["id"]]["share"] > 0
        side = "in frame" if inside else ("behind the camera" if abs(deg) > 90 else f"from frame {'left' if deg < 0 else 'right'}")
        light_sides.append({"id": it["id"], "label": it["label"], "type": it["light"]["type"], "kelvin": it["light"].get("kelvin"), "side": side, "deg": round(deg, 1)})
    looks = []
    for m in plan["marks"]:
        if m["id"] not in on_set:
            continue
        mf = math.radians(m["facing"])
        g = (math.sin(mf), math.cos(mf))
        to_cam = (cx - m["at"][0], cy - m["at"][1])
        n = math.hypot(*to_cam) or 1
        c = (g[0] * to_cam[0] + g[1] * to_cam[1]) / n
        lateral = g[0] * right[0] + g[1] * right[1]
        look = "toward camera" if c > 0.87 else "away from camera" if c < -0.87 else f"toward frame {'right' if lateral > 0 else 'left'}"
        looks.append({"mark": m["id"], "who": m["who"], "looks": look})
    visible.sort(key=lambda v: (seen[v["id"]]["cx"]))
    summary = "In frame, left to right: " + "; ".join(f"{v['label']} ({v['where']})" for v in visible if v["kind"] != "wall") + "."
    if edges:
        summary += " Just outside the frame: " + "; ".join(f"{e['label']} ({e['side']})" for e in edges) + "."
    if behind:
        summary += " Behind or beside this camera, so not visible: " + "; ".join(b["label"] for b in behind if b["kind"] != "wall") + "."
    return {"setup": setup["id"], "lens": setup["lens"], "at": setup["at"], "facing": setup["facing"], "half_fov": round(half, 1),
            "walls": walls, "visible": visible, "edges": edges, "hidden": hidden, "behind": behind, "lights": light_sides, "eyelines": looks, "summary": summary}


cams = {}
for s in plan["setups"]:
    cam_data = bpy.data.cameras.new(s["id"])
    cam_data.lens = s["lens"]
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.sensor_width = SENSOR
    cam_data.clip_start = 0.05
    cam = bpy.data.objects.new(s["id"], cam_data)
    scene.collection.objects.link(cam)
    x, y = s["at"]
    cam.location = (x, y, s["height"])
    cam.rotation_euler = (math.radians(90 + s.get("tilt", 0)), 0, math.radians(-s["facing"]))
    cam["setup"], cam["name"], cam["lens"], cam["beat"] = s["id"], s["name"], s["lens"], s.get("beat", "")
    cams[s["id"]] = cam

if glb:
    scene.render.resolution_x, scene.render.resolution_y = res_x, res_y  # the cameras' aspect in the GLB
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_cameras=True, export_lights=True, export_extras=True, export_apply=True)
    print(f"exported {glb}")

if flags.get("--top"):
    top = bpy.data.cameras.new("top")
    top.type = "ORTHO"
    top.sensor_fit = "VERTICAL"
    top.ortho_scale = D + 1.0
    tcam = bpy.data.objects.new("top", top)
    scene.collection.objects.link(tcam)
    tcam.location = (W / 2, D / 2, H + 6)
    scene.camera = tcam
    bpy.data.objects["ceiling"].hide_render = True
    for parts in stand_ins.values():
        for o in parts:
            o.hide_render = False
    cycles()
    scene.render.resolution_x, scene.render.resolution_y = round(1300 * (W + 1) / (D + 1)), 1300
    scene.render.filepath = flags["--top"]
    bpy.ops.render.render(write_still=True)
    bpy.data.objects["ceiling"].hide_render = False
    print(f"rendered the lighting plot -> {flags['--top']}")

for s in ([] if "--glb-only" in flags or flags.get("--top") else plan["setups"]):
    if only and s["id"] not in only:
        continue
    on_set = {m["id"] for m in plan["marks"] if not m.get("beat") or not s.get("beat") or m["beat"] == s["beat"]}
    for mid, parts in stand_ins.items():
        for o in parts:
            o.hide_render = not (with_marks and mid in on_set)
    cam = cams[s["id"]]
    scene.camera = cam
    cycles()
    scene.render.filepath = f"{out_dir}/{s['id']}{'-blocking' if with_marks else ''}.png"
    bpy.ops.render.render(write_still=True)
    print(f"rendered {s['id']} -> {scene.render.filepath}")
    if with_ids:
        for mid, parts in stand_ins.items():
            for o in parts:
                o.hide_render = mid not in on_set
        vis = report(s, id_pass(cam, s, on_set), on_set)
        json.dump(vis, open(f"{out_dir}/{s['id']}.vis.json", "w"), indent=1)
        print(f"visibility {s['id']}: {vis['summary']}")
