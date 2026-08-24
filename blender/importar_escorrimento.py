# -*- coding: utf-8 -*-
"""
Escorrimento → Blender/Cycles: renderização fotorrealista da simulação.

A física vem do solver deste repositório (exportada por
`npx tsx src/tests/export3d.ts`); o Blender entra APENAS como renderizador
(malha da superfície por Points→Volume→Mesh, água com IOR 1.333 e absorção
volumétrica, céu físico Nishita, Cycles com denoise).

Uso (Blender 3.6+ / 4.x, testado headless):

    # um quadro (o último exportado):
    blender -b -P blender/importar_escorrimento.py -- exports

    # intervalo de quadros e amostras:
    blender -b -P blender/importar_escorrimento.py -- exports 1 96 --samples=256

Saída: exports/render/quadro_####.png
"""

import bpy
import json
import math
import os
import re
import sys


# ---------------------------------------------------------------- argumentos

def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    out = {"dir": "exports", "ini": None, "fim": None, "samples": 128}
    pos = []
    for a in argv:
        if a.startswith("--samples="):
            out["samples"] = int(a.split("=")[1])
        else:
            pos.append(a)
    if len(pos) >= 1:
        out["dir"] = pos[0]
    if len(pos) >= 2:
        out["ini"] = int(pos[1])
    if len(pos) >= 3:
        out["fim"] = int(pos[2])
    return out


ARGS = parse_args()
DIR = os.path.abspath(ARGS["dir"])
with open(os.path.join(DIR, "cena.json"), "r", encoding="utf-8") as f:
    CENA = json.load(f)

# Simulação usa +Y para cima; Blender usa +Z para cima:
#   (x, y, z)_sim  →  (x, z_sim, y_sim)_blender


def bl(x, y, z):
    return (x, z, y)


# ------------------------------------------------------------------- limpeza

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = ARGS["samples"]
scene.cycles.use_denoising = True
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.view_settings.view_transform = "Filmic"
scene.view_settings.look = "Medium High Contrast"


# ------------------------------------------------------------------ materiais

def mat_agua():
    m = bpy.data.materials.new("Agua")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.9, 0.96, 1.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.02
    bsdf.inputs["IOR"].default_value = 1.333
    # Blender 4.x: "Transmission Weight"; 3.x: "Transmission"
    for nome in ("Transmission Weight", "Transmission"):
        if nome in bsdf.inputs:
            bsdf.inputs[nome].default_value = 1.0
            break
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    # Absorção volumétrica (tom verde-azulado da água real com profundidade)
    vol = nt.nodes.new("ShaderNodeVolumeAbsorption")
    vol.inputs["Color"].default_value = (0.36, 0.68, 0.75, 1.0)
    vol.inputs["Density"].default_value = 0.9
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    return m


def mat_aco():
    m = bpy.data.materials.new("Aco")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.35, 0.37, 0.40, 1.0)
    b.inputs["Metallic"].default_value = 1.0
    b.inputs["Roughness"].default_value = 0.35
    return m


def mat_leito():
    m = bpy.data.materials.new("Leito")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 60.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.05, 0.07, 0.06, 1)
    ramp.color_ramp.elements[1].color = (0.16, 0.15, 0.12, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.9
    return m


M_AGUA = mat_agua()
M_ACO = mat_aco()
M_LEITO = mat_leito()


# ---------------------------------------------------------------- cena fixa

def add_caixa(nome, centro, dims, mat):
    bpy.ops.mesh.primitive_cube_add(location=bl(*centro))
    ob = bpy.context.object
    ob.name = nome
    ob.scale = (dims[0] / 2, dims[2] / 2, dims[1] / 2)  # (x, z_sim, y_sim)
    ob.data.materials.append(mat)
    return ob


T = CENA["tubo"]
DOM = CENA["dominio"]
RES = CENA["reservatorio"]

# leito do canal e "chão" ao redor
add_caixa("Leito", (DOM["L"] / 2, -0.05, DOM["W"] / 2),
          (DOM["L"] * 3, 0.1, DOM["W"] * 6), M_LEITO)
# paredes do canal (laterais em z)
for zc in (0.0, DOM["W"]):
    add_caixa(f"ParedeCanal_{zc}", (DOM["L"] / 2, CENA["nivel_agua"] / 2, zc),
              (DOM["L"] * 3, CENA["nivel_agua"] + 0.1, 0.06), M_LEITO)

# tubo em L: curva amostrada no mesmo caminho do SDF do solver
def pontos_tubo():
    xC, yC, xT, yA, Rc = T["xC"], T["yC"], T["xTube"], T["yA"], T["raio_cotovelo"]
    cx, cy = xT + Rc, yC + Rc          # centro do arco do cotovelo
    pts = [(xC, yC), (xT + Rc, yC)]    # trecho horizontal (boca C → cotovelo)
    for a in range(1, 12):             # arco 270° → 180°
        ang = math.radians(270 - 90 * a / 12.0)
        pts.append((cx + Rc * math.cos(ang), cy + Rc * math.sin(ang)))
    pts.append((xT, yA))               # trecho vertical até o bocal A
    return pts


curva = bpy.data.curves.new("TuboL", type="CURVE")
curva.dimensions = "3D"
sp = curva.splines.new("POLY")
pts = pontos_tubo()
sp.points.add(len(pts) - 1)
for i, (x, y) in enumerate(pts):
    px, py, pz = bl(x, y, T["zC"])
    sp.points[i].co = (px, py, pz, 1)
curva.bevel_depth = T["D"] / 2 + T["parede"]
curva.bevel_resolution = 16
curva.use_fill_caps = False
tubo = bpy.data.objects.new("TuboL", curva)
bpy.context.collection.objects.link(tubo)
tubo.data.materials.append(M_ACO)

# reservatório: 4 paredes + piso (o furo do tubo fica implícito na vista)
py0 = RES["piso_y"]
add_caixa("ResPiso", ((RES["x0"] + RES["x1"]) / 2, py0, (RES["z0"] + RES["z1"]) / 2),
          (RES["x1"] - RES["x0"], 0.04, RES["z1"] - RES["z0"]), M_ACO)
for (cx, cz, dx_, dz_) in (
    (RES["x0"], (RES["z0"] + RES["z1"]) / 2, 0.04, RES["z1"] - RES["z0"]),
    (RES["x1"], (RES["z0"] + RES["z1"]) / 2, 0.04, RES["z1"] - RES["z0"]),
    ((RES["x0"] + RES["x1"]) / 2, RES["z0"], RES["x1"] - RES["x0"], 0.04),
    ((RES["x0"] + RES["x1"]) / 2, RES["z1"], RES["x1"] - RES["x0"], 0.04),
):
    add_caixa("ResParede", (cx, py0 + RES["altura"] / 2, cz),
              (dx_, RES["altura"], dz_), M_ACO)

# ------------------------------------------------------- iluminação e câmera

# céu físico (Nishita) — fim de tarde
world = bpy.data.worlds.new("Ceu")
scene.world = world
world.use_nodes = True
wn = world.node_tree
wn.nodes.clear()
sky = wn.nodes.new("ShaderNodeTexSky")
sky.sky_type = "NISHITA"
sky.sun_elevation = math.radians(12)
sky.sun_rotation = math.radians(230)
sky.sun_intensity = 0.6
bg = wn.nodes.new("ShaderNodeBackground")
out = wn.nodes.new("ShaderNodeOutputWorld")
wn.links.new(sky.outputs["Color"], bg.inputs["Color"])
wn.links.new(bg.outputs["Background"], out.inputs["Surface"])

# sol adicional para especular firme
bpy.ops.object.light_add(type="SUN")
sun = bpy.context.object
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(55), 0, math.radians(140))

# câmera 3/4 mirando a boca C (apontada por constraint TRACK_TO)
bpy.ops.object.camera_add()
cam = bpy.context.object
alvo = bl(T["xC"] - 0.3, CENA["nivel_agua"] + 0.2, T["zC"])
cam.location = (T["xC"] + 3.0, T["zC"] - 4.2, CENA["nivel_agua"] + 1.9)
alvo_empty = bpy.data.objects.new("AlvoCam", None)
bpy.context.collection.objects.link(alvo_empty)
alvo_empty.location = alvo
tc = cam.constraints.new(type="TRACK_TO")
tc.target = alvo_empty
tc.track_axis = "TRACK_NEGATIVE_Z"
tc.up_axis = "UP_Y"
scene.camera = cam


# -------------------------------------------------- água: PLY → volume → malha

def montar_agua(caminho_ply):
    # remove água anterior
    for nome in ("AguaPontos", "AguaMalha"):
        ob = bpy.data.objects.get(nome)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)

    # importador PLY: 4.x usa wm.ply_import; 3.x usa import_mesh.ply
    if hasattr(bpy.ops.wm, "ply_import"):
        bpy.ops.wm.ply_import(filepath=caminho_ply)
    else:
        bpy.ops.import_mesh.ply(filepath=caminho_ply)
    pontos = bpy.context.object
    pontos.name = "AguaPontos"
    # sim é Y-para-cima: gira -90° em X para Z-para-cima
    pontos.rotation_euler = (math.radians(90), 0, 0)

    # Geometry Nodes: Mesh→Points→Volume→Mesh
    gn = pontos.modifiers.new("AguaGN", "NODES")
    tree = bpy.data.node_groups.new("AguaNodes", "GeometryNodeTree")
    gn.node_group = tree
    try:
        tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
        tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    except AttributeError:  # Blender 3.x
        tree.inputs.new("NodeSocketGeometry", "Geometry")
        tree.outputs.new("NodeSocketGeometry", "Geometry")
    n_in = tree.nodes.new("NodeGroupInput")
    n_out = tree.nodes.new("NodeGroupOutput")
    m2p = tree.nodes.new("GeometryNodeMeshToPoints")
    p2v = tree.nodes.new("GeometryNodePointsToVolume")
    v2m = tree.nodes.new("GeometryNodeVolumeToMesh")
    setmat = tree.nodes.new("GeometryNodeSetMaterial")
    shade = tree.nodes.new("GeometryNodeSetShadeSmooth")

    r = CENA["raio_particula"]
    p2v.inputs["Radius"].default_value = 1.7 * r
    p2v.resolution_mode = "VOXEL_SIZE"
    p2v.inputs["Voxel Size"].default_value = max(0.8 * r, 0.012)
    v2m.resolution_mode = "VOXEL_SIZE"
    v2m.inputs["Voxel Size"].default_value = max(0.8 * r, 0.012)
    setmat.inputs["Material"].default_value = M_AGUA

    lk = tree.links.new
    lk(n_in.outputs[0], m2p.inputs["Mesh"])
    lk(m2p.outputs["Points"], p2v.inputs["Points"])
    lk(p2v.outputs["Volume"], v2m.inputs["Volume"])
    lk(v2m.outputs["Mesh"], shade.inputs["Geometry"])
    lk(shade.outputs["Geometry"], setmat.inputs["Geometry"])
    lk(setmat.outputs["Geometry"], n_out.inputs[0])
    return pontos


# --------------------------------------------------------------- renderização

quadros = sorted(
    f for f in os.listdir(DIR) if re.fullmatch(r"quadro_\d{4}\.ply", f)
)
if not quadros:
    raise SystemExit(f"Nenhum quadro_####.ply em {DIR} — rode o exportador antes.")

ini = ARGS["ini"] or len(quadros)
fim = ARGS["fim"] or ini
os.makedirs(os.path.join(DIR, "render"), exist_ok=True)

def render_still():
    """Renderiza com denoise; se o build não tiver OpenImageDenoise
    (ex.: pacote do Ubuntu), desliga o denoise e tenta de novo."""
    try:
        bpy.ops.render.render(write_still=True)
    except RuntimeError as e:
        if "Denois" in str(e) or "denois" in str(e):
            print("[aviso] build sem OpenImageDenoise — renderizando sem denoise")
            scene.cycles.use_denoising = False
            bpy.ops.render.render(write_still=True)
        else:
            raise


for n in range(ini, fim + 1):
    nome = f"quadro_{n:04d}.ply"
    if nome not in quadros:
        print(f"[aviso] {nome} não existe; pulando")
        continue
    montar_agua(os.path.join(DIR, nome))
    scene.render.filepath = os.path.join(DIR, "render", f"quadro_{n:04d}.png")
    print(f"Renderizando {nome} → {scene.render.filepath}")
    render_still()

print("Concluído.")
