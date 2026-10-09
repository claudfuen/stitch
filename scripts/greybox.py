# Build a location's grey box from its floor plan and render every camera setup from it.
# The plan in data/project.json is the only source: walls from its size, boxes from its items, mannequins on its marks,
# one camera per setup (Super 35, the setup's lens, height, facing and tilt).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/greybox.py -- <plan.json> <out_dir> [setup ...]
#       [--glb room.glb] [--glb-only] [--clay] [--detail] [--anim <take.json> <out.mp4>]
#
# `--anim` renders a blockout instead of stills: one camera moving through a take's shots (stage 06). The take lists
# shots {cam, t0, t1, beat, stage?} in seconds; the camera holds each setup (place, height, facing, tilt, lens) and
# whips to the next in `whip` seconds, and each mark or item tied to beats exists only in its beat's shots (`stage`
# names another beat's marks, when the story has the cast already moved: Brock arriving at centre for his line). Rendered as H.264
# with no sound; the take's audio is added after.
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
anim = None
if "--anim" in argv:
    k = argv.index("--anim")
    anim, argv = argv[k + 1:k + 3], argv[:k] + argv[k + 3:]
glb = argv[argv.index("--glb") + 1] if "--glb" in argv else None
render = "--glb-only" not in argv and anim is None
clay = "--clay" in argv  # ignore the plan's palette and item colours: the plain grey box
detail = "--detail" in argv  # recognisable shapes (palms, stools, lettering) and posed mannequins instead of blocks
argv = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--glb")]
plan = json.load(open(argv[0]))
out_dir = argv[1]
only = set(argv[2:])
take = json.load(open(anim[0])) if anim else {}
# A take's "look": "film" renders the blockout in EEVEE, lit like a film set (key, rims, wall washes, haze, depth of
# field, motion blur) instead of flat Workbench clay: the video model copies the blockout's light as well as its layout.
film = take.get("look") == "film"
# "arms": false builds the cast as torsos, legs and heads only: rigid stick arms pinned the model to wrong arm poses,
# while without them it takes the arms from the reference stills and the prompt.
armless = take.get("arms") is False
NEON = {}  # neon material name -> the sign's real colour, lit in the film look whatever the clay says
# A take can restage the set for itself without touching the approved plan: "restage": {"marks" | "items" | "setups":
# [{id, ...fields}]} patches those entries by id (a new id adds one), e.g. Henrick moved behind the desk.
for _k, _patches in take.get("restage", {}).items():
    for _p in _patches:
        _hit = next((x for x in plan[_k] if x["id"] == _p["id"]), None)
        _hit.update(_p) if _hit else plan[_k].append(_p)

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
        real = [tuple(it.get("color", rgb))] + ([tuple(it.get("color2", SHAPE_RGB["cyan"]))] if it.get("text2") else [])
        for k, (t_, c) in enumerate(words):
            NEON[f"{m}-text{k}"] = real[k]
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
                NEON[f"{m}-stripe{k}-{j}"] = c
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
            box(f"{n}:tv{i}", x - (w / 2) - 0.02 if w < d else x, y if w < d else y - d / 2 - 0.02, z + 0.4 + i * 0.7, 0.04 if w < d else 0.5, 0.5 if w < d else 0.04, 0.38, SHAPE_RGB["dark"], 0, material="screen")
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
if film and (plan.get("panels") or take.get("panels")):
    # Panel seams on the far wall, every "panels" metres: the approved frames show a panelled set wall, not plaster.
    pitch = plan.get("panels") or take["panels"]
    for k in range(1, int(W / pitch) + 1):
        box(f"wall:seam:{k}", k * pitch, D - 0.015, 0, 0.035, 0.03, H, (0.62, 0.62, 0.64), material="seam")
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
    neck = base + up * (shoulder_z + 0.02)
    limb(f"neck:{m['id']}", neck, neck + up * (head_z - shoulder_z - 0.08), 0.055, SHAPE_RGB["skin"], "skin")
    nose = base + up * (head_z - 0.01) + fw * 0.11
    box(f"nose:{m['id']}", nose.x, nose.y, nose.z - 0.025, 0.04, 0.04, 0.05, SHAPE_RGB["skin"], m["facing"], material="skin")
    arms = m.get("arms", "folded" if sit else "down")
    for s_ in () if armless else (-1, 1):
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


FIGS = {}  # mark id -> the joints of each of its figures (a stand-in mark has a seated and a standing one)


def figure(m, rgb, sit, f):
    """An articulated stand-in for the animated blockout (docs/blockout-motion.md): a chain of joints (hips, two spine
    joints, neck, head; thighs, knees, feet) that the take's moves rotate, with the body built on it. No arms: the
    model takes those from the reference stills and the prompt."""
    x, y = m["at"]
    legs_rgb = tuple(PAL.get("legs", {}).get(m["who"], rgb))
    mm, ml = f"person-{m['who']}", f"legs-{m['who']}"
    J = {}

    def joint(name, parent, loc, rot=(0.0, 0.0, 0.0)):
        e = bpy.data.objects.new(f"{name}:{m['id']}:{m['pose']}", None)
        scene.collection.objects.link(e)
        e.parent = parent
        e.location = loc
        e.rotation_euler = rot
        J[name] = e
        return e

    def on(j, o):
        o.parent = j  # built in the joint's own space
        return o

    hip = m.get("seat", 0.5 if m["who"] == "audience" else 0.47) + 0.02 if sit else 0.93  # a chair; a bar stool says "seat"
    root = joint("root", None, (x, y, m.get("z", 0)), (0, 0, -f))
    hips = joint("hips", root, (0, 0, hip))
    on(hips, box(f"pelvis:{m['id']}", 0, 0, -0.12, 0.36, 0.22, 0.2, legs_rgb, material=ml))
    s1 = joint("spine1", hips, (0, 0, 0.06))
    on(s1, box(f"belly:{m['id']}", 0, 0, 0, 0.37, 0.23, 0.26, rgb, material=mm))
    s2 = joint("spine2", s1, (0, 0, 0.24))
    on(s2, box(f"chest:{m['id']}", 0, 0, 0, 0.44, 0.25, 0.25, rgb, material=mm))
    nk = joint("neck", s2, (0, 0, 0.25))
    on(nk, cyl(f"neck:{m['id']}", 0, 0, 0, 0.055, 0.11, SHAPE_RGB["skin"], "skin"))
    hd = joint("head", nk, (0, 0, 0.1))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.115, location=(0, 0, 0.12))
    head = bpy.context.object
    head.name = f"head:{m['id']}"
    head.scale = (0.92, 1.0, 1.1)
    head.data.materials.append(mat("skin", SHAPE_RGB["skin"]))
    on(hd, head)
    on(hd, box(f"nose:{m['id']}", 0, 0.11, 0.08, 0.04, 0.04, 0.05, SHAPE_RGB["skin"], material="skin"))
    for s_, side in ((-1, "l"), (1, "r")):
        th = joint(f"thigh_{side}", hips, (0.1 * s_, 0, -0.04), (math.radians(90) if sit else 0.0, 0, 0))
        on(th, limb(f"thigh:{m['id']}:{s_}", (0, 0, 0), (0, 0, -0.42), 0.075, legs_rgb, ml))
        kn = joint(f"knee_{side}", th, (0, 0, -0.42), (math.radians(-90) if sit else 0.0, 0, 0))
        on(kn, limb(f"shin:{m['id']}:{s_}", (0, 0, 0), (0, 0, -0.4), 0.06, legs_rgb, ml))
        ft = joint(f"foot_{side}", kn, (0, 0, -0.4))
        on(ft, box(f"foot:{m['id']}:{s_}", 0, 0.06, -0.07, 0.1, 0.25, 0.07, SHAPE_RGB["dark"], material="dark"))
    if sit and m["who"] == "audience" and detail:
        fw = mathutils.Vector((math.sin(f), math.cos(f), 0))
        lift = m.get("z", 0)
        box(f"seat:{m['id']}", x - fw.x * 0.05, y - fw.y * 0.05, lift + 0.38, 0.46, 0.46, 0.06, SHAPE_RGB["seat"], m["facing"], material="seat")
        back = mathutils.Vector((x, y, lift)) - fw * 0.26
        box(f"seatback:{m['id']}", back.x, back.y, lift + 0.42, 0.46, 0.06, 0.5, SHAPE_RGB["seat"], m["facing"], material="seat")
    FIGS.setdefault(m["id"], []).append(J)


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
        (figure if anim else mannequin)(m, rgb, sit, f)
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

def film_look():
    """EEVEE, lit like a set: the take's lights (area or spot, aimed at a point), a dark studio with a little haze for
    the light to cut through, AgX contrast, real motion blur; chrome shines, the floor is glossy, the sign and the
    monitors glow."""
    scene.render.engine = "BLENDER_EEVEE"
    ee = scene.eevee
    ee.taa_render_samples = take.get("samples", 32)
    ee.use_raytracing = True
    ee.use_shadows = True
    ee.volumetric_samples = 64
    ee.use_volumetric_shadows = True
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.5  # 180 degrees, a film camera's shutter
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = take.get("exposure", 0.0)
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    world = bpy.data.worlds.new("studio")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes["Background"].inputs[0].default_value = (0.008, 0.008, 0.01, 1)
    if take.get("haze", 0.006):
        vol = nt.nodes.new("ShaderNodeVolumeScatter")
        vol.inputs["Density"].default_value = take.get("haze", 0.006)
        vol.inputs["Anisotropy"].default_value = 0.45
        nt.links.new(vol.outputs[0], nt.nodes["World Output"].inputs["Volume"])
    for name, m in mats.items():
        b = m.node_tree.nodes.get("Principled BSDF")
        if not b:
            continue
        b.inputs["Roughness"].default_value = 0.7
        if name == "chrome":
            b.inputs["Metallic"].default_value = 1.0
            b.inputs["Roughness"].default_value = 0.12
        elif name == "floor":
            b.inputs["Roughness"].default_value = 0.2
        elif name == "ceiling":
            b.inputs["Base Color"].default_value = (0.03, 0.03, 0.035, 1)
        elif name == "skin":
            b.inputs["Roughness"].default_value = 0.5
        elif "screen" in name:
            b.inputs["Emission Color"].default_value = (0.55, 0.7, 1.0, 1)
            b.inputs["Emission Strength"].default_value = 2.5
        elif name in NEON:
            c = NEON[name]
            b.inputs["Base Color"].default_value = (*c, 1)
            b.inputs["Emission Color"].default_value = (*c, 1)
            b.inputs["Emission Strength"].default_value = take.get("neon", 9.0)
    for k, sp in enumerate(take.get("lights", [])):
        kind = sp.get("kind", "area")
        ld = bpy.data.lights.new(f"light-{k}", type="SPOT" if kind == "spot" else "AREA")
        ld.energy = sp["power"]
        ld.color = sp.get("color", (1.0, 1.0, 1.0))
        if kind == "spot":
            ld.spot_size = math.radians(sp.get("spot", 45))
            ld.spot_blend = sp.get("blend", 0.5)
            ld.shadow_soft_size = sp.get("size", 0.3)
        else:
            ld.shape = "RECTANGLE"
            ld.size, ld.size_y = (sp.get("size", 2.0), sp.get("size_y", sp.get("size", 2.0)))
        ld.volume_factor = sp.get("haze", 1.0)
        o = bpy.data.objects.new(f"light-{k}", ld)
        scene.collection.objects.link(o)
        o.location = sp["at"]
        o.rotation_euler = (mathutils.Vector(sp["aim"]) - mathutils.Vector(sp["at"])).to_track_quat("-Z", "Y").to_euler()


if anim:
    fps = take.get("fps", 24) * take.get("oversample", 1)  # oversampled frames are blended back down for motion blur
    whip = take.get("whip", 0.3)
    shots = take["shots"]
    scene.render.fps = fps
    scene.render.resolution_x, scene.render.resolution_y = take.get("size", [1280, 720])
    scene.frame_start = 1
    scene.frame_end = max(1, round(min(shots[-1]["t1"], take.get("render_to", 1e9)) * fps))  # render_to: only the head
    if film:
        film_look()
    cd = bpy.data.cameras.new("cam-take")
    cd.sensor_fit = "HORIZONTAL"
    cd.sensor_width = SENSOR
    cd.clip_start = 0.05
    cam = bpy.data.objects.new("cam-take", cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    setups = {s["id"]: s for s in plan["setups"]}
    edit = bpy.context.preferences.edit
    V = mathutils.Vector

    # Who and what is on the set: a mark or item tied to beats exists only in shots of those beats; it switches at the
    # cut, in the middle of the whip, so a move between marks happens off camera.
    edit.keyframe_new_interpolation_type = "CONSTANT"
    beats_of = {}
    for beat, names in beat_objects.items():
        for name in names:
            beats_of.setdefault(name, set()).add(beat)
    for sh in shots:
        f = 1 + sh["t0"] * fps
        staged = sh.get("stage", sh.get("beat"))
        for name, beats in beats_of.items():
            o = bpy.data.objects[name]
            o.hide_render = staged not in beats
            o.keyframe_insert("hide_render", frame=f)
        for names, (mode, beats) in variants:
            on = staged in beats
            for name in names:
                o = bpy.data.objects[name]
                o.hide_render = on if mode == "hide" else not on
                o.keyframe_insert("hide_render", frame=f)

    def ease(u, e="io"):
        u = min(max(u, 0.0), 1.0)
        if e == "l":
            return u
        if e == "o":  # fast start, soft landing: a push that punches in, a crash zoom
            return 1 - (1 - u) ** 3
        if e == "i":
            return u ** 3
        return u * u * (3 - 2 * u)

    def track(pts, t, default=0.0):
        """[[t, value, ease?], ...] eased between points, held before the first and after the last."""
        if not pts:
            return default
        if t <= pts[0][0]:
            return pts[0][1]
        for a, b in zip(pts, pts[1:]):
            if t <= b[0]:
                return a[1] + (b[1] - a[1]) * ease((t - a[0]) / max(b[0] - a[0], 1e-6), b[2] if len(b) > 2 else "io")
        return pts[-1][1]

    # Moves (docs/blockout-motion.md). The blockout is a reference for where people are, which way they face, when
    # they walk, turn or lean, and for the camera; the model adds arms, hands, faces and acting. So the figures move
    # like people filmed in a studio: an articulated body with slow idle life (weight shift, breathing, head drift on
    # noise, never a sine), accents on the script's beats, and no rhythmic bouncing. On a mark:
    #   "path": [[t, dx, dy], ...]  walk along it, strides and knees from the speed
    #   "turn": [[t, deg], ...]     face further clockwise; the head leads, the chest follows, then the hips
    #   "lean": [[t, deg], ...]     bend forward through the spine (negative: back)
    #   "head": [[t, yaw, pitch]]   look right (+yaw) and down (+pitch) from the chest
    #   "nods": [t, ...], "nod": d  a quick dip of the head on a stressed word, d degrees (4 by default)
    #   "slam": [t, ...]            pitch down onto the desk through the spine, the head dropping on impact
    #   "tip": [[t, deg], ...]      the whole figure rocks backwards about its feet (a chair going over)
    #   "idle": factor              idle life, 1 by default
    # {"crowd": who, ...} gives every mark of that role the move, each late by up to "spread" seconds.
    # {"item": id, "drop": t} crushes the item flat onto its surface in 0.45 s; {"item": id, "tilt": [[t, deg], ...],
    # "toward": facing} tips it over toward a heading; {"item": id, "rise": [[t, height factor], ...]} grows or shrinks
    # it from its base (a pile of paper building up).
    from bpy_extras import anim_utils
    edit.keyframe_new_interpolation_type = "BEZIER"
    marks = {m["id"]: m for m in plan["marks"]}
    per_mark = {}
    for mv in take.get("moves", []):
        if "item" in mv:
            it = next(i for i in plan["items"] if i["id"] == mv["item"])
            e = bpy.data.objects.new(f"rig:{it['id']}", None)
            scene.collection.objects.link(e)
            e.location = (it["at"][0], it["at"][1], it.get("z", 0))  # scale about the surface it stands on
            bpy.context.view_layer.update()
            for o in list(bpy.data.objects):
                if o.get("item") == it["id"] and o.parent is None and o is not e:
                    o.parent = e
                    o.matrix_parent_inverse = e.matrix_world.inverted()
            if "drop" in mv:
                t = mv["drop"]
                for tt, sz in ((t - 0.02, 1.0), (t + 0.12, 0.6), (t + 0.3, 0.08), (t + 0.45, 0.03)):
                    e.scale = (1, 1, sz)
                    e.keyframe_insert("scale", frame=1 + tt * fps)
            for tt, sz in mv.get("rise", []):
                e.scale = (1, 1, max(0.01, sz))
                e.keyframe_insert("scale", frame=1 + tt * fps)
            if mv.get("tilt"):
                # Tip toward a heading: the rig turns to face it before anything is parented, then rolls forward.
                for o in list(bpy.data.objects):
                    if o.parent is e:
                        o.parent = None
                        o.matrix_parent_inverse.identity()
                e.rotation_euler = (0, 0, -math.radians(mv.get("toward", 0)))
                bpy.context.view_layer.update()
                for o in list(bpy.data.objects):
                    if o.get("item") == it["id"] and o is not e:
                        mw = o.matrix_world.copy()
                        o.parent = e
                        o.matrix_parent_inverse = e.matrix_world.inverted()
                        o.matrix_world = mw
                n = max(1, round((mv["tilt"][-1][0] - mv["tilt"][0][0]) * 24))
                t0_, t1_ = mv["tilt"][0][0], mv["tilt"][-1][0]
                for k in range(n + 1):
                    tt = t0_ + (t1_ - t0_) * k / n
                    e.rotation_euler = (-math.radians(track(mv["tilt"], tt)), 0, -math.radians(mv.get("toward", 0)))
                    e.keyframe_insert("rotation_euler", frame=1 + tt * fps)
        elif "crowd" in mv:
            for m in plan["marks"]:
                if m["who"] == mv["crowd"]:
                    h = sum(ord(c) * (k + 7) for k, c in enumerate(m["id"]))
                    per_mark.setdefault(m["id"], []).append({**mv, "delay": (h % 97) / 97 * mv.get("spread", 0.15), "seed": h})
        else:
            per_mark.setdefault(mv["mark"], []).append(mv)

    def pulse(t, times, attack=0.08, release=0.4):
        """0 to 1 and back: up fast just before each time, down slowly after it."""
        v = 0.0
        for a in times:
            d = t - a
            if -attack <= d < 0:
                v = max(v, ease((d + attack) / attack))
            elif 0 <= d <= release:
                v = max(v, 1 - ease(d / release, "o"))
        return v

    def slam_lean(times):
        pts = []
        for t in times:
            pts += [[t - 0.4, 0.0], [t - 0.14, -4.0], [t, 20.0, "i"], [t + 0.3, 7.0, "o"], [t + 0.6, 2.0]]
        return pts

    R = math.radians
    CHANNELS = {"root": ("location", "rotation_euler"), "hips": ("location", "rotation_euler"), "spine1": ("rotation_euler",),
                "spine2": ("rotation_euler",), "head": ("rotation_euler",), "thigh_l": ("rotation_euler",), "thigh_r": ("rotation_euler",),
                "knee_l": ("rotation_euler",), "knee_r": ("rotation_euler",), "foot_l": ("rotation_euler",), "foot_r": ("rotation_euler",)}

    def fcurve(o, path, i):
        cb = anim_utils.action_get_channelbag_for_slot(o.animation_data.action, o.animation_data.action_slot)
        return cb.fcurves.find(path, index=i)

    for mid, figs in FIGS.items():
        mvs = per_mark.get(mid, [])
        m = marks[mid]
        idle = 1.0
        for mv in mvs:
            idle = mv.get("idle", idle)
        seed = sum(ord(c) * (k + 3) for k, c in enumerate(mid))
        for J in figs:
            rest = {name: (tuple(J[name].location), tuple(J[name].rotation_euler)) for name in CHANNELS}
            for name, paths in CHANNELS.items():  # a rest key on every channel, so idle noise has a curve to ride on
                for path_ in paths:
                    J[name].keyframe_insert(path_, frame=1)
            # Idle life: slow noise on the weight (hips roll), the breath (chest pitch), the chest and the head.
            for k, (name, idx, deg, period) in enumerate((("hips", 1, 1.2, 70), ("spine2", 0, 0.8, 95), ("spine2", 2, 1.5, 60), ("head", 2, 2.5, 48), ("head", 0, 1.5, 40))):
                if idle <= 0:
                    break
                mod = fcurve(J[name], "rotation_euler", idx).modifiers.new("NOISE")
                mod.scale = period * fps / 24
                mod.strength = 2 * R(deg) * idle
                mod.phase = (seed * (k + 1)) % 1000 / 10.0
            if not mvs:
                continue
            times = []
            for mv in mvs:
                d = mv.get("delay", 0.0)
                times += [p[0] + d for key in ("path", "turn", "lean", "head", "tip") for p in mv.get(key, [])]
                times += [t + d for t in mv.get("nods", []) + mv.get("slam", [])]
            if not times:
                continue
            t0, t1 = max(0.0, min(times) - 0.6), max(times) + 0.8
            n = max(1, round((t1 - t0) * 24))
            # Gait pre-pass: where the figure is at every sample, how far it has walked, which way it is heading.
            # A walking figure faces where it walks (unless the move says "face": false), and its feet are planted:
            # each foot stays put on the floor through its stance while the body passes over it, then swings to the
            # next footprint, and the legs reach each footprint by two-joint IK. So nothing slides.
            ts = [t0 + (t1 - t0) * k / n for k in range(n + 1)]
            paths = [mv for mv in mvs if mv.get("path")]

            def path_at(mv, u):
                pts = mv["path"]
                if u <= pts[0][0]:
                    return V((pts[0][1], pts[0][2], 0))
                if u >= pts[-1][0]:
                    return V((pts[-1][1], pts[-1][2], 0))
                for (a0, x0, y0), (a1, x1, y1) in zip(pts, pts[1:]):
                    if a0 <= u <= a1:
                        w = (u - a0) / max(a1 - a0, 1e-6)
                        return V((x0 + (x1 - x0) * w, y0 + (y1 - y0) * w, 0))
                return V((pts[-1][1], pts[-1][2], 0))

            P = [sum((path_at(mv, t - mv.get("delay", 0.0)) for mv in paths), V((0, 0, 0))) for t in ts]
            D = [0.0]
            for a_, b_ in zip(P, P[1:]):
                D.append(D[-1] + (b_ - a_).length)
            HD, SP = [], []
            for i in range(len(ts)):
                a_, b_ = P[max(0, i - 1)], P[min(len(P) - 1, i + 1)]
                v = b_ - a_
                dt = ts[min(len(P) - 1, i + 1)] - ts[max(0, i - 1)]
                SP.append(v.length / max(dt, 1e-6))
                HD.append(math.degrees(math.atan2(v.x, v.y)) if v.length > 1e-4 else None)
            last = None  # hold the last real heading through the stop
            for i in range(len(HD)):
                if HD[i] is None:
                    HD[i] = last
                last = HD[i] if HD[i] is not None else last
            face_walk = paths and all(mv.get("face", True) for mv in paths) and m.get("pose") != "sit"
            WW = [min(1.0, sp / 0.5) for sp in SP]  # how much the body is walking, smoothed over 0.2 s
            WW = [sum(WW[max(0, i - 2):i + 3]) / len(WW[max(0, i - 2):i + 3]) for i in range(len(WW))]
            walking = [i for i, w in enumerate(WW) if w > 0.05]
            avg_sp = (D[-1] / max(1e-6, (ts[walking[-1]] - ts[walking[0]]) if walking else 1)) if walking else 0.0
            step = min(0.95, max(0.5, 0.42 + 0.2 * avg_sp))  # metres per step: longer when faster
            DUTY = 0.58

            def pos_at_dist(x):
                """The path offset where the walked distance reaches x."""
                if x <= 0:
                    return P[0], 0
                for i in range(1, len(D)):
                    if D[i] >= x:
                        w = (x - D[i - 1]) / max(D[i] - D[i - 1], 1e-9)
                        return P[i - 1].lerp(P[i], w), i
                return P[-1], len(P) - 1

            def foot_world(side_s, d):
                """Where a foot is on the floor (world xy, height) when the body has walked d metres."""
                o = 0.0 if side_s < 0 else step
                cyc = 2 * step
                q = ((d - o) % cyc) / cyc
                j = math.floor((d - o) / cyc)
                plant = o + j * cyc + 0.5 * DUTY * cyc  # the body passes over this footprint mid-stance
                if q < DUTY:
                    x, lift = plant, 0.0
                    roll = abs(q - 0.5 * DUTY) / (0.5 * DUTY)  # heel strike, then toe off: the ankle rises a little
                    ank = 0.07 + 0.05 * roll * roll
                else:
                    w = ease((q - DUTY) / (1 - DUTY))
                    x, lift = plant + w * cyc, 0.09 * math.sin(math.pi * w)
                    ank = 0.07 + 0.05 + lift
                pos, i = pos_at_dist(x)
                h = math.radians(HD[i] if HD[i] is not None else m.get("facing", 0))
                lat = V((math.cos(h), -math.sin(h), 0)) * (0.1 * side_s)
                return V(rest["root"][0]) + pos + lat + V((0, 0, ank))

            dist, prev = 0.0, None
            for k in range(n + 1):
                t = t0 + (t1 - t0) * k / n
                off, turn, turn_lag, lean, yaw, pitch, speed, tip = V((0, 0, 0)), 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
                for mv in mvs:
                    tt = t - mv.get("delay", 0.0)
                    pts = mv.get("path")
                    if pts:
                        def at(u):
                            if u <= pts[0][0]:
                                return V((pts[0][1], pts[0][2], 0))
                            if u >= pts[-1][0]:
                                return V((pts[-1][1], pts[-1][2], 0))
                            for (a0, x0, y0), (a1, x1, y1) in zip(pts, pts[1:]):
                                if a0 <= u <= a1:
                                    w = ease((u - a0) / max(a1 - a0, 1e-6), "l")
                                    return V((x0 + (x1 - x0) * w, y0 + (y1 - y0) * w, 0))
                            return V((pts[-1][1], pts[-1][2], 0))
                        here = at(tt)
                        off += here
                        speed = max(speed, (at(tt + 0.02) - at(tt - 0.02)).length / 0.04)
                    turn += track(mv.get("turn", []), tt)
                    tip += track(mv.get("tip", []), tt)
                    turn_lag += track(mv.get("turn", []), tt - 0.12)
                    lean += track(mv.get("lean", []), tt) + (track(slam_lean(mv["slam"]), tt) if mv.get("slam") else 0.0)
                    hp = mv.get("head", [])
                    yaw += track([[p[0], p[1]] for p in hp], tt)
                    pitch += track([[p[0], p[2]] for p in hp], tt)
                    pitch += mv.get("nod", 4.0) * pulse(tt, mv.get("nods", []))
                    if mv.get("slam"):
                        pitch += 12.0 * pulse(tt, mv["slam"], 0.06, 0.35)
                if face_walk and HD[k] is not None:
                    want = (HD[k] - m.get("facing", 0) - turn + 540) % 360 - 180
                    turn += WW[k] * want
                    turn_lag += WW[k] * want
                if prev is not None:
                    dist += (off - prev).length
                prev = off.copy()
                walk = min(1.0, speed / 0.8)
                ph = math.pi * dist / 0.75  # a 0.75 m stride
                fr = 1 + t * fps
                (rl, rr) = rest["root"]
                J["root"].location = V(rl) + off
                J["root"].rotation_euler = (rr[0] + R(tip), rr[1], rr[2] - R(turn_lag))
                hl, hr = rest["hips"]
                J["hips"].location = V(hl) + V((0, 0, 0.018 * walk * (abs(math.cos(ph)) - 0.5)))
                J["spine1"].rotation_euler = (rest["spine1"][1][0] - R(0.45 * lean), 0, 0)
                J["spine2"].rotation_euler = (rest["spine2"][1][0] - R(0.55 * lean), 0, -R(turn - turn_lag) * 0.6 + R(5 * walk * math.sin(ph)))
                J["head"].rotation_euler = (-R(pitch) + R(0.3 * lean), 0, -R(yaw) - R(turn - turn_lag) * 0.4)
                ik = face_walk and walking and ts[walking[0]] - 0.1 <= t <= ts[walking[-1]] + 0.35
                if ik:
                    # Hips drop a little while walking (knees never lock), and bob twice per stride.
                    J["hips"].location = V(hl) + V((0, 0, -0.05 * WW[k] + 0.02 * WW[k] * math.cos(4 * math.pi * D[k] / (2 * step))))
                    bpy.context.view_layer.update()
                    for side, s_ in (("l", -1), ("r", 1)):
                        tgt = foot_world(s_, D[k])
                        th = J[f"thigh_{side}"]
                        thigh_w = J["hips"].matrix_world @ V(rest[f"thigh_{side}"][0])
                        rot = J["hips"].matrix_world.to_3x3().normalized().inverted()
                        v = rot @ (tgt - thigh_w)
                        L1, L2 = 0.42, 0.40
                        dd = min(L1 + L2 - 0.004, max(0.2, math.hypot(v.y, v.z)))
                        a_ = math.atan2(v.y, -v.z)
                        b_ = math.acos(max(-1, min(1, (L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd))))
                        g_ = math.acos(max(-1, min(1, (L1 * L1 + L2 * L2 - dd * dd) / (2 * L1 * L2))))
                        th.rotation_euler = (a_ + b_, 0, 0)
                        J[f"knee_{side}"].rotation_euler = (-(math.pi - g_), 0, 0)
                        J[f"foot_{side}"].rotation_euler = (-(a_ + b_) + (math.pi - g_), 0, 0)
                else:
                    for side, p_ in (("l", ph), ("r", ph + math.pi)):
                        tr = rest[f"thigh_{side}"][1]
                        kr = rest[f"knee_{side}"][1]
                        J[f"thigh_{side}"].rotation_euler = (tr[0] + R(26 * walk * math.sin(p_)), 0, 0)
                        J[f"knee_{side}"].rotation_euler = (kr[0] - R(walk * (6 + 40 * max(0.0, math.cos(p_)))), 0, 0)
                        J[f"foot_{side}"].rotation_euler = rest[f"foot_{side}"][1]
                for name, paths in CHANNELS.items():
                    for path_ in paths:
                        J[name].keyframe_insert(path_, frame=fr)

    # The camera, set frame by frame: each shot holds its setup and plays its move, and the camera whips to the next
    # setup in `whip` seconds. A shot's move eases the setup's offsets between keys, each field on its own:
    #   "move": [[t, {"dolly": m, "truck": m, "ped": m, "pan": deg, "tilt": deg, "roll": deg, "lens": mm, "e": ease}]]
    #   (dolly along the view, truck to the right, ped up; ease "io" default, "o" punch in, "i" ease in, "l" linear)
    #   "hand": degrees of slow operator drift; "shake": [[t, degrees]], a jolt that dies in about half a second;
    #   "focus": a mark id or [x, y, z] the lens is focused on, "fstop": aperture (film look only).
    FIELDS = ("dolly", "truck", "ped", "pan", "tilt", "roll", "lens")

    def cam_pose(k, t):
        sh = shots[k]
        su = setups[sh["cam"]]
        keys = sh.get("move") or []
        o = {}
        for fld in FIELDS:
            pts = [[kt, kv[fld], kv.get("e", "io")] for kt, kv in keys if fld in kv]
            o[fld] = track(pts, t, su["lens"] if fld == "lens" else 0.0)
        a, ph = sh.get("hand", take.get("hand", 0.1)), k * 1.7
        pan = a * (0.6 * math.sin(2 * math.pi * 0.31 * t + ph) + 0.4 * math.sin(2 * math.pi * 0.77 * t + 2 * ph))
        tilt = a * 0.7 * (0.6 * math.sin(2 * math.pi * 0.43 * t + 3 * ph) + 0.4 * math.sin(2 * math.pi * 0.97 * t + ph))
        for ts, amp in sh.get("shake", []):
            if t >= ts:
                d = t - ts
                env = amp * math.exp(-d / 0.16)
                tilt += env * math.sin(2 * math.pi * 13 * d)
                pan += 0.5 * env * math.sin(2 * math.pi * 11 * d + 1)
        yaw = math.radians(su["facing"] + o["pan"] + pan)
        fw, rt = V((math.sin(yaw), math.cos(yaw), 0)), V((math.cos(yaw), -math.sin(yaw), 0))
        loc = V((su["at"][0], su["at"][1], su["height"] + o["ped"])) + fw * o["dolly"] + rt * o["truck"]
        return loc, -yaw, math.radians(90 + (su.get("tilt") or 0) + o["tilt"] + tilt), math.radians(o["roll"]), o["lens"]

    holds = [(sh["t0"] + (whip / 2 if k else 0), sh["t1"] - (whip / 2 if k < len(shots) - 1 else 0)) for k, sh in enumerate(shots)]

    def shot_at(t):
        for k, (h0, h1) in enumerate(holds):
            if t <= h1 or k == len(holds) - 1:
                return k
        return len(holds) - 1

    heads = {}
    for o in bpy.data.objects:
        if o.name.startswith("head:") and o.get("mark") and o.get("mark") not in heads:
            heads[o["mark"]] = o
    if film:
        cd.dof.use_dof = True
    yaw_prev = None
    for fr in range(scene.frame_start, scene.frame_end + 1):
        t = (fr - 1) / fps
        k = shot_at(t)
        if t >= holds[k][0] or k == 0:
            loc, yaw, tilt, roll, lens = cam_pose(k, max(t, holds[k][0]) if k else t)
            near = k
        else:  # in the whip from shot k-1 into shot k
            a, b = holds[k - 1][1], holds[k][0]
            u = ease((t - a) / max(b - a, 1e-6))
            p0, p1 = cam_pose(k - 1, a), cam_pose(k, b)
            y0, y1 = p0[1], p1[1]
            while y1 - y0 > math.pi:
                y1 -= 2 * math.pi
            while y1 - y0 < -math.pi:
                y1 += 2 * math.pi
            loc = p0[0].lerp(p1[0], u)
            yaw, tilt, roll, lens = y0 + (y1 - y0) * u, p0[2] + (p1[2] - p0[2]) * u, p0[3] + (p1[3] - p0[3]) * u, p0[4] + (p1[4] - p0[4]) * u
            near = k - 1 if u < 0.5 else k
        if yaw_prev is not None:  # one continuous yaw, so the curve never spins the long way round
            while yaw - yaw_prev > math.pi:
                yaw -= 2 * math.pi
            while yaw - yaw_prev < -math.pi:
                yaw += 2 * math.pi
        yaw_prev = yaw
        cam.location = loc
        cam.rotation_euler = (tilt, roll, yaw)
        cd.lens = lens
        cam.keyframe_insert("location", frame=fr)
        cam.keyframe_insert("rotation_euler", frame=fr)
        cd.keyframe_insert("lens", frame=fr)
        if film:
            sh = shots[near]
            cd.dof.aperture_fstop = sh.get("fstop", 2.8)
            cd.keyframe_insert("dof.aperture_fstop", frame=fr)
    if film:
        # Focus: the distance from the lens to the shot's focus target, read from the animated scene every third frame.
        for fr in range(scene.frame_start, scene.frame_end + 1, 3):
            scene.frame_set(fr)
            t = (fr - 1) / fps
            k = shot_at(t)
            if k and t < holds[k][0] and t < (holds[k - 1][1] + holds[k][0]) / 2:
                k -= 1
            tgt = shots[k].get("focus")
            if isinstance(tgt, str) and tgt in heads:
                p = heads[tgt].matrix_world.translation
            elif isinstance(tgt, list):
                p = V(tgt)
            else:
                continue
            view = cam.matrix_world.to_quaternion() @ V((0, 0, -1))
            cd.dof.focus_distance = max(0.3, (p - cam.matrix_world.translation).dot(view))
            cd.keyframe_insert("dof.focus_distance", frame=fr)
        scene.frame_set(1)
    scene.render.image_settings.media_type = "VIDEO" if hasattr(scene.render.image_settings, "media_type") else scene.render.image_settings.file_format
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    if take.get("stills"):  # test frames instead of the film: [t, ...] seconds, written as PNGs next to the film
        scene.render.image_settings.media_type = "IMAGE" if hasattr(scene.render.image_settings, "media_type") else "PNG"
        scene.render.image_settings.file_format = "PNG"
        for t in take["stills"]:
            scene.frame_set(1 + round(t * fps))
            scene.render.filepath = f"{anim[1]}-{t:05.2f}.png"
            bpy.ops.render.render(write_still=True)
            print(f"rendered still {t} -> {scene.render.filepath}")
    else:
        scene.render.filepath = anim[1]
        bpy.ops.render.render(animation=True)
        print(f"rendered {scene.frame_end} frames -> {anim[1]}")
