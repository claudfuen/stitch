# Build a location's grey box from its floor plan and render every camera setup from it.
# The plan in data/project.json is the only source: walls from its size, boxes from its items, mannequins on its marks,
# one camera per setup (Super 35, the setup's lens, height, facing and tilt).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/greybox.py -- <plan.json> <out_dir> [setup ...]
#       [--glb room.glb] [--glb-only] [--clay] [--detail]
#
# `bun run stitch greybox <location>` writes the plan out, runs this and registers the renders on the board.
# `--glb` also exports the built room (every camera, plan item and mark, tagged with their plan ids as glTF extras) for
# the board's Rooms view, so the room you audit in the browser is the same scene the renders come from.
import json
import math
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
glb = argv[argv.index("--glb") + 1] if "--glb" in argv else None
render = "--glb-only" not in argv
clay = "--clay" in argv  # ignore the plan's palette and item colours: the plain grey box
detail = "--detail" in argv  # recognisable shapes (palms, stools, lettering) and posed mannequins instead of blocks
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


def box(name, cx, cy, z, w, d, h, rgb, rot=0.0, material=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, z + h / 2))
    o = bpy.context.object
    o.name = name
    o.scale = (w, d, h)
    o.rotation_euler = (0, 0, math.radians(-rot))
    o.data.materials.append(mat(material or name.split(":")[0], rgb))
    return o


def cyl(name, x, y, z0, r, h, rgb, material, verts=32):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=(x, y, z0 + h / 2), vertices=verts)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat(material, rgb))
    return o


def limb(name, a, b, r, rgb, material):
    """A cylinder from point a to point b: an arm, a leg, a palm frond."""
    va, vb = mathutils.Vector(a), mathutils.Vector(b)
    d = vb - va
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=max(d.length, 0.01), location=(va + vb) / 2, vertices=12)
    o = bpy.context.object
    o.name = name
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = d.to_track_quat("Z", "Y")
    o.data.materials.append(mat(material, rgb))
    return o


def lettering(name, text, x, y, z, w, h, rgb, material, depth=0.03):
    """Extruded lettering standing up and facing -y (toward the cameras), fitted to w x h."""
    bpy.ops.object.text_add(location=(x, y, z))
    o = bpy.context.object
    o.name = name
    o.data.body = text.replace("\\n", "\n")
    o.data.align_x = "CENTER"
    o.data.align_y = "CENTER"
    o.data.extrude = depth
    o.data.size = h
    o.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.view_layer.update()
    if o.dimensions.x > 0:
        k = min(w / o.dimensions.x, 1.0)
        o.scale = (k, k, 1)
    o.data.materials.append(mat(material, rgb))
    return o


SHAPE_RGB = {"chrome": (0.80, 0.80, 0.84), "trunk": (0.42, 0.32, 0.22), "pot": (0.88, 0.88, 0.88), "dark": (0.12, 0.12, 0.13),
             "skin": (0.86, 0.70, 0.60), "seat": (0.48, 0.12, 0.18), "cyan": (0.45, 0.95, 0.95)}


def shaped(it, rgb):
    """Detailed geometry for an item with a "shape"; returns False to fall back to a box."""
    (x, y), (w, d, h), z, sh, n = it["at"], it["size"], it.get("z", 0), it.get("shape"), f"{it['kind']}:{it['id']}"
    m = f"{it['kind']}-{it['id']}"
    if sh == "palm":
        cyl(f"{n}:pot", x, y, z, min(w, d) * 0.32, 0.45, SHAPE_RGB["pot"], "pot")
        top = (x, y, z + h * 0.72)
        limb(f"{n}:trunk", (x, y, z + 0.45), top, 0.05, SHAPE_RGB["trunk"], "trunk")
        for k in range(9):
            a = 2 * math.pi * k / 9
            reach = w * 0.75
            limb(f"{n}:frond{k}", top, (x + math.cos(a) * reach, y + math.sin(a) * reach, z + h * (0.55 if k % 2 else 0.95)), 0.07, rgb, m)
        return True
    if sh == "stool":
        cyl(f"{n}:base", x, y, z, min(w, d) * 0.5, 0.03, SHAPE_RGB["chrome"], "chrome")
        cyl(f"{n}:pole", x, y, z, 0.03, h - 0.08, SHAPE_RGB["chrome"], "chrome")
        cyl(f"{n}:seat", x, y, z + h - 0.08, min(w, d) * 0.45, 0.08, rgb, m)
        return True
    if sh == "column":
        cyl(n, x, y, z, min(w, d) / 2, h, rgb, m)
        return True
    if sh == "capsule":
        # A curved-end desk: a box between two half-round ends, a chrome kick band and a top that overhangs a little.
        r = d / 2
        box(f"{n}:mid", x, y, z, w - d, d, h, rgb, 0, material=m)
        for e in (-1, 1):
            cyl(f"{n}:end{e}", x + e * (w - d) / 2, y, z, r, h, rgb, m)
            cyl(f"{n}:band{e}", x + e * (w - d) / 2, y, z, r + 0.02, 0.10, SHAPE_RGB["chrome"], "chrome")
            cyl(f"{n}:top{e}", x + e * (w - d) / 2, y, z + h - 0.04, r + 0.05, 0.04, rgb, m)
        box(f"{n}:band", x, y, z, w - d, d + 0.04, 0.10, SHAPE_RGB["chrome"], 0, material="chrome")
        box(f"{n}:top", x, y, z + h - 0.04, w - d, d + 0.10, 0.04, rgb, 0, material=m)
        return True
    if sh == "neon":
        # The sign's own lettering plus the two stripes under it, glowing on the wall.
        # "text2" in "color2" is a second word in its own colour (the approved sign: COMP in pink, AI in teal).
        words = [(it.get("text", it["label"]), rgb)] + ([(it["text2"], tuple(it.get("color2", SHAPE_RGB["cyan"])))] if it.get("text2") else [])
        parts = []
        for k, (t_, c) in enumerate(words):
            t = lettering(f"{n}:text{k}", t_, x, y - 0.06, z + h * 0.62, 99, h * 0.55, c, f"{m}-text{k}")
            t.data.shear = 0.25  # the approved sign is italic
            parts.append(t)
        bpy.context.view_layer.update()
        gap = h * 0.55 * 0.35
        widths = [p_.dimensions.x for p_ in parts]
        total = sum(widths) + gap * (len(parts) - 1)
        k = min(w / total, 1.0)
        left = x - total * k / 2
        for p_, wd in zip(parts, widths):
            p_.scale = (k, k, 1)
            p_.location.x = left + wd * k / 2
            left += (wd + gap) * k
        # Stripes under the words; "stripe_gradient": [left, right] shades each stripe across its length.
        grad = it.get("stripe_gradient")
        for k in range(it.get("stripe_count", 2)):
            segs = 16 if grad else 1
            for j in range(segs):
                f_ = j / max(segs - 1, 1)
                c = tuple(grad[0][i] + (grad[1][i] - grad[0][i]) * f_ for i in range(3)) if grad else (rgb if k == 0 else SHAPE_RGB["cyan"])
                sw = w * 0.95 / segs
                box(f"{n}:stripe{k}:{j}", x - w * 0.95 / 2 + sw * (j + 0.5), y - 0.06, z + h * (0.2 - 0.09 * k), sw + 0.002, 0.03, 0.035, c, 0, material=f"{m}-stripe{k}-{j}")
        return True
    if sh == "sign":
        # A hanging card with its lettering on the camera-facing side.
        box(f"{n}:card", x, y, z, w, d, h, rgb, 0, material=m)
        for side in (-1, 1):
            lettering(f"{n}:text{side}", it.get("text", it["label"]), x, y + side * (d / 2 + 0.01), z + h / 2, w * 0.9, h * 0.32, SHAPE_RGB["dark"], "dark", 0.005)
        return True
    if sh == "button":
        box(f"{n}:base", x, y, z, w, d, 0.07, (0.55, 0.55, 0.58), 0, material="button-base")
        cyl(f"{n}:dome", x, y, z + 0.07, min(w, d) * 0.38, h - 0.07, rgb, m)
        return True
    if sh == "stack":
        k = max(1, int(it.get("count", 12)))
        for i in range(k):
            box(f"{n}:{i}", x, y, z + i * h / k, w, d, h / k * 0.88, rgb, 0, material=m)
        return True
    if sh == "shelves":
        box(f"{n}:frame", x, y, z, w, d, h, rgb, it.get("rot", 0), material=m)
        for i in range(3):
            box(f"{n}:tv{i}", x - (w / 2) - 0.02 if w < d else x, y if w < d else y - d / 2 - 0.02, z + 0.4 + i * 0.7, 0.04 if w < d else 0.5, 0.5 if w < d else 0.04, 0.38, SHAPE_RGB["dark"], 0, material="dark")
        return True
    if sh in ("task-chair", "chair"):
        # A chair facing "facing" (degrees, 0 = +y): the back sits behind the seat. Without a facing, the operator
        # row's convention (backs toward the aisle).
        if "facing" in it:
            fa = math.radians(it["facing"])
            fx, fy, rot_ = math.sin(fa), math.cos(fa), it["facing"]
        else:
            fx, fy, rot_ = 0.0, (1.0 if it["at"][1] < 5 else -1.0), 0
        if sh == "task-chair":
            cyl(f"{n}:base", x, y, 0, 0.28, 0.04, SHAPE_RGB["dark"], "dark", 5)
            cyl(f"{n}:pole", x, y, 0.04, 0.025, 0.38, SHAPE_RGB["dark"], "dark")
            box(f"{n}:seat", x, y, 0.42, 0.46, 0.44, 0.07, rgb, rot_, material=m)
        else:
            box(f"{n}:seat", x, y, 0.43, 0.42, 0.42, 0.04, rgb, rot_, material=m)
            for lx, ly in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                rx, ry = math.cos(math.radians(rot_)), -math.sin(math.radians(rot_))
                px, py = x + rx * 0.18 * lx + fx * 0.18 * ly, y + ry * 0.18 * lx + fy * 0.18 * ly
                box(f"{n}:leg{lx}{ly}", px, py, 0, 0.04, 0.04, 0.43, rgb, rot_, material=m)
        box(f"{n}:back", x - fx * 0.2, y - fy * 0.2, 0.47, 0.42, 0.05, 0.5, rgb, rot_, material=m)
        return True
    if sh == "phone":
        box(f"{n}:body", x, y, z, w, d, h, rgb, 0, material=m)
        box(f"{n}:handset", x - w * 0.25, y, z + h, w * 0.3, d * 0.9, 0.04, rgb, 0, material=m)
        return True
    return False


# A plan may carry a palette: the room in the set's real colours instead of clay, so the layout render carries the
# look as well as the geometry (a grey wall in the layout came back as a grey wall in the frame). Items take a
# "color"; the far wall can take a two-colour "far_gradient" (left to right as seen from the entrance).
PAL = {} if clay else plan.get("palette", {})
shell = lambda k: tuple(PAL.get(k, GREY[k]))
W, D, H = plan["width"], plan["depth"], plan["height"]
T = 0.15
box("floor", W / 2, D / 2, -0.05, W, D, 0.05, shell("floor"))
box("ceiling", W / 2, D / 2, H, W, D, 0.05, shell("ceiling"))
box("wall:entrance", W / 2, -T / 2, 0, W + 2 * T, T, H, shell("wall"))
if PAL.get("far_gradient"):
    (a, b), n = PAL["far_gradient"], 24
    for k in range(n):
        f = k / (n - 1)
        rgb = tuple(a[i] + (b[i] - a[i]) * f for i in range(3))
        box(f"wall:far:{k}", -T + (W + 2 * T) * (k + 0.5) / n, D + T / 2, 0, (W + 2 * T) / n + 0.01, T, H, rgb, material=f"wall-far-{k}")
else:
    box("wall:far", W / 2, D + T / 2, 0, W + 2 * T, T, H, shell("wall"))
box("wall:left", -T / 2, D / 2, 0, T, D, H, shell("wall"))
box("wall:right", W + T / 2, D / 2, 0, T, D, H, shell("wall"))

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
    rgb = tuple(it["color"]) if it.get("color") and not clay else GREY.get(kind, GREY["prop"])
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
    elif (detail or it.get("always_shape")) and it.get("shape") and shaped(it, rgb):
        pass
    else:
        box(f"{kind}:{it['id']}", x, y, z, w, d, h, rgb, rot, material=f"{kind}-{it['id']}" if it.get("color") and not clay else None)
    tag(before_item, item=it["id"], kind=kind, label=it["label"])
    for b in it.get("beats", [it["beat"]] if it.get("beat") else []):
        beat_objects.setdefault(b, []).extend(set(bpy.data.objects.keys()) - before_item)

def mannequin(m, rgb, sit, f):
    """A posed figure: torso and legs in the costume colour, a skin-toned head with a nose for the facing, and arms
    set by the mark's "arms" (down, wide, up, forward, thumbs, clap, folded, phone, write)."""
    x, y = m["at"]
    lift = m.get("z", 0)
    fw = mathutils.Vector((math.sin(f), math.cos(f), 0))
    rt = mathutils.Vector((math.cos(f), -math.sin(f), 0))
    base = mathutils.Vector((x, y, lift))
    up = mathutils.Vector((0, 0, 1))
    legs = tuple(PAL.get("legs", {}).get(m["who"], rgb))
    mm, ml = f"person-{m['who']}", f"legs-{m['who']}"
    if sit:
        hip, shoulder_z, head_z = 0.50, 0.98, 1.20
        for s_ in (-1, 1):
            h0 = base + rt * (0.1 * s_) + up * hip
            knee = h0 + fw * 0.42
            limb(f"thigh:{m['id']}:{s_}", h0, knee, 0.075, legs, ml)
            limb(f"shin:{m['id']}:{s_}", knee, knee - up * (hip - 0.02), 0.06, legs, ml)
        if m["who"] == "audience" and detail:
            box(f"seat:{m['id']}", x - fw.x * 0.05, y - fw.y * 0.05, lift + 0.38, 0.46, 0.46, 0.06, SHAPE_RGB["seat"], m["facing"], material="seat")
            back = base - fw * 0.26
            box(f"seatback:{m['id']}", back.x, back.y, lift + 0.42, 0.46, 0.06, 0.5, SHAPE_RGB["seat"], m["facing"], material="seat")
    else:
        hip, shoulder_z, head_z = 0.92, 1.42, 1.64
        for s_ in (-1, 1):
            h0 = base + rt * (0.1 * s_) + up * hip
            limb(f"leg:{m['id']}:{s_}", h0, base + rt * (0.12 * s_), 0.075, legs, ml)
    torso = base + up * hip
    box(f"torso:{m['id']}", torso.x, torso.y, torso.z, 0.42, 0.24, shoulder_z - hip + 0.04, rgb, m["facing"], material=mm)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.115, location=(x, y, lift + head_z))
    hd = bpy.context.object
    hd.name = f"head:{m['id']}"
    hd.data.materials.append(mat("skin", SHAPE_RGB["skin"]))
    nose = base + up * (head_z - 0.01) + fw * 0.11
    box(f"nose:{m['id']}", nose.x, nose.y, nose.z - 0.025, 0.04, 0.04, 0.05, SHAPE_RGB["skin"], m["facing"], material="skin")
    arms = m.get("arms", "folded" if sit else "down")
    for s_ in (-1, 1):
        sh = base + up * shoulder_z + rt * (0.25 * s_)
        if arms == "wide":
            hand = sh + rt * (0.62 * s_) + up * 0.18
        elif arms == "up":
            hand = sh + up * 0.62 + fw * 0.12
        elif arms == "forward":
            hand = sh + fw * 0.62 + up * 0.05 if s_ == 1 else sh - up * 0.55 + rt * 0.08 * s_
        elif arms == "thumbs":
            hand = sh + fw * 0.32 - up * 0.12 + rt * (-0.08 * s_)
        elif arms == "clap":
            hand = base + up * (shoulder_z - 0.12) + fw * 0.32 + rt * (0.04 * s_)
        elif arms in ("folded", "write"):
            hand = base + up * (hip + 0.12) + fw * (0.3 if arms == "folded" else 0.45) + rt * (0.05 * s_)
        elif arms == "phone":
            hand = (base + up * (head_z - 0.02) + rt * 0.14) if s_ == 1 else (base + up * (hip + 0.12) + fw * 0.4)
        else:
            hand = sh - up * 0.58 + rt * (0.06 * s_)
        limb(f"arm:{m['id']}:{s_}", sh, hand, 0.055, rgb, mm)


expanded = []
for m in plan["marks"]:
    if m.get("stand_in"):
        expanded.append(({**m, "pose": "sit"}, ("hide", set(m["stand_in"]))))
        expanded.append(({**m, "pose": "stand", "arms": m.get("stand_arms", "clap")}, ("show", set(m["stand_in"]))))
    else:
        expanded.append((m, None))
for m, variant in expanded:
    before = set(bpy.data.objects.keys())
    x, y = m["at"]
    rgb = tuple(PAL.get("people", {}).get(m["who"], PEOPLE.get(m["who"], (0.58, 0.58, 0.58))))
    sit = m["pose"] == "sit"
    f = math.radians(m["facing"])
    if detail:
        mannequin(m, rgb, sit, f)
        tag(before, mark=m["id"], who=m["who"], beat=m.get("beat"), pose=m["pose"])
        for b in m.get("beats", [m["beat"]] if m.get("beat") else []):
            beat_objects.setdefault(b, []).extend(set(bpy.data.objects.keys()) - before)
        if variant:
            variants.append((set(bpy.data.objects.keys()) - before, variant))
        continue
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
    for b in m.get("beats", [m["beat"]] if m.get("beat") else []):
        beat_objects.setdefault(b, []).extend(set(bpy.data.objects.keys()) - before)
    if variant:
        variants.append((set(bpy.data.objects.keys()) - before, variant))

# Light: a soft daylight from the left windows plus a fill, so shapes read in Workbench.
scene.render.engine = "BLENDER_WORKBENCH"
shading = scene.display.shading
# Clay reads by shading; a coloured box reads by its colours, so it is lit flat with outlines for the edges.
shading.light = "FLAT" if PAL else "STUDIO"
shading.color_type = "MATERIAL"
shading.show_shadows = True
shading.show_cavity = True
shading.cavity_type = "WORLD"
shading.show_object_outline = bool(PAL)
shading.object_outline_color = (0.15, 0.15, 0.15)
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
    # An item or mark with "beat" (or a "beats" list) exists only in those beats.
    shown = {}
    for beat, names in beat_objects.items():
        for name in names:
            shown[name] = shown.get(name, False) or not s.get("beat") or beat == s.get("beat")
    for name, on in shown.items():
        bpy.data.objects[name].hide_render = not on
    for names, (mode, beats) in variants:
        on = s.get("beat") in beats
        for name in names:
            bpy.data.objects[name].hide_render = on if mode == "hide" else not on
    scene.render.filepath = f"{out_dir}/{s['id']}.png"
    bpy.ops.render.render(write_still=True)
    print(f"rendered {s['id']} -> {scene.render.filepath}")
