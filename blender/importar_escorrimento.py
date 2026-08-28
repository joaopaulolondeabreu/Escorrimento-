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

    # mais rápido: placa de vídeo, resolução menor, um quadro a cada dois:
    blender -b -P blender/importar_escorrimento.py -- exports 1 96 \
        --gpu --res=720p --samples=48 --passo=2

    # placa + processador juntos (ganho modesto, máquina fica pesada):
    blender -b -P blender/importar_escorrimento.py -- exports 1 96 --gpu --hibrido

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
    out = {"dir": "exports", "ini": None, "fim": None, "samples": 128,
           "res": (1920, 1080), "gpu": False, "hibrido": False, "passo": 1}
    pos = []
    for a in argv:
        if a.startswith("--samples="):
            out["samples"] = int(a.split("=")[1])
        elif a.startswith("--res="):
            valor = a.split("=")[1].lower()
            atalhos = {"720p": (1280, 720), "1080p": (1920, 1080),
                       "1440p": (2560, 1440), "4k": (3840, 2160)}
            if valor in atalhos:
                out["res"] = atalhos[valor]
            else:
                largura, altura = valor.split("x")
                out["res"] = (int(largura), int(altura))
        elif a.startswith("--passo="):
            out["passo"] = max(1, int(a.split("=")[1]))
        elif a in ("--gpu", "--placa"):
            out["gpu"] = True
        elif a.startswith("--gpu=") or a.startswith("--placa="):
            out["gpu"] = a.split("=")[1].upper()   # OPTIX, CUDA, HIP, ...
        elif a in ("--hibrido", "--cpu-junto"):
            out["hibrido"] = True
        elif a.startswith("-"):
            # Um parâmetro escrito errado (um "]" colado no fim, por exemplo)
            # passava despercebido como argumento posicional e a opção era
            # silenciosamente ignorada — agora o script avisa.
            print(f"[aviso] parâmetro desconhecido, ignorado: {a}")
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


# ------------------------------------------- compatibilidade entre versões
# Nomes de enum e de soquete mudam entre versões do Blender (por exemplo, o
# céu "NISHITA" do 3.x/4.x virou "SINGLE_SCATTERING"/"MULTIPLE_SCATTERING"
# no 5.x, e "Transmission" virou "Transmission Weight" no 4.x). Em vez de
# fixar nomes, o script pergunta ao próprio Blender o que existe e escolhe
# a melhor opção disponível — assim ele não quebra na próxima versão.

def def_enum(dado, prop, *preferencias):
    """Tenta os valores em ordem e mantém o primeiro que a versão aceitar.

    A tentativa direta é o caminho confiável: enums dinâmicos (a
    transformação de vista e o look vêm da configuração OCIO) não expõem a
    lista real por bl_rna — ela chega como um item de espaço reservado.
    Não achando nenhum, deixa o valor padrão da versão e avisa.
    """
    if not hasattr(dado, prop):
        print(f"[aviso] esta versão não tem a propriedade {prop}")
        return None
    for p in preferencias:
        try:
            setattr(dado, prop, p)
            return p
        except (TypeError, ValueError):
            continue
    atual = getattr(dado, prop, None)
    print(f"[aviso] nenhum valor de {preferencias} serve para {prop}; "
          f"mantendo o padrão ({atual})")
    return atual


def def_prop(dado, prop, valor):
    """Atribui a propriedade só se ela existir nesta versão."""
    if hasattr(dado, prop):
        try:
            setattr(dado, prop, valor)
            return True
        except Exception as erro:
            print(f"[aviso] não consegui definir {prop}: {erro}")
    return False


def def_entrada(no, valor, *nomes):
    """Atribui o primeiro soquete de entrada que existir entre os nomes."""
    for n in nomes:
        if n in no.inputs:
            no.inputs[n].default_value = valor
            return n
    print(f"[aviso] nenhuma entrada {nomes} em {no.bl_idname} nesta versão")
    return None


def principled(node_tree):
    """O nó Principled BSDF do material padrão, achado pelo tipo."""
    for n in node_tree.nodes:
        if n.bl_idname == "ShaderNodeBsdfPrincipled":
            return n
    return node_tree.nodes.new("ShaderNodeBsdfPrincipled")


print(f"Blender {'.'.join(str(v) for v in bpy.app.version)}")


# ------------------------------------------------------------------- limpeza

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = ARGS["samples"]
scene.cycles.use_denoising = True


def usar_gpu(preferido=None, hibrido=False):
    """Liga o Cycles na placa de vídeo, se houver uma utilizável.

    Percorre os back-ends na ordem de preferência (OptiX e CUDA em NVIDIA,
    HIP em AMD, Metal em Mac, oneAPI em Intel) ou usa só o `preferido`, se
    informado (--gpu=cuda, por exemplo, para contornar um driver antigo).
    Sem placa compatível, avisa e continua na CPU — renderizar mais devagar
    é melhor do que abortar no meio de uma sequência.
    """
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except KeyError:
        print("[aviso] Cycles indisponível nas preferências; seguindo na CPU")
        return False
    for metodo in ("refresh_devices", "get_devices"):
        if hasattr(prefs, metodo):
            try:
                getattr(prefs, metodo)()
            except Exception:
                pass
            break
    ordem = (preferido,) if preferido else ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI")
    for tipo in ordem:
        try:
            prefs.compute_device_type = tipo
        except (TypeError, ValueError):
            continue
        placas = [d for d in prefs.devices if d.type == tipo]
        if not placas:
            continue
        # No modo híbrido o processador entra como dispositivo adicional. O
        # ganho é limitado pela razão entre os dois: somar uma CPU três vezes
        # mais lenta que a placa corta ~25% do tempo, no melhor caso, e parte
        # disso se perde na coordenação — e a máquina fica pesada para usar.
        cpus = [d for d in prefs.devices if d.type == "CPU"]
        for d in prefs.devices:
            d.use = (d.type == tipo) or (hibrido and d.type == "CPU")
        scene.cycles.device = "GPU"
        print(f"Renderizando na GPU ({tipo}): "
              + ", ".join(d.name for d in placas))
        if hibrido:
            print("Processador somado à renderização: "
                  + (", ".join(d.name for d in cpus) or "nenhum encontrado"))
        if tipo == "OPTIX":
            # o denoise do OptiX roda na própria placa e é bem mais rápido
            def_enum(scene.cycles, "denoiser", "OPTIX", "OPENIMAGEDENOISE")
        return True
    if preferido:
        print(f"[aviso] nenhuma placa utilizável pelo back-end {preferido} "
              "(driver antigo ou placa incompatível?); renderizando na CPU")
    else:
        print("[aviso] nenhuma placa de vídeo compatível com o Cycles foi "
              "encontrada; renderizando na CPU")
    return False


if ARGS["gpu"]:
    usar_gpu(ARGS["gpu"] if isinstance(ARGS["gpu"], str) else None,
             hibrido=ARGS["hibrido"])
elif ARGS["hibrido"]:
    print("[aviso] --hibrido só faz sentido junto com --gpu; ignorado")
scene.render.resolution_x, scene.render.resolution_y = ARGS["res"]
# "Filmic" saiu da configuração padrão em versões novas; "AgX" o sucede.
transform = def_enum(scene.view_settings, "view_transform", "Filmic", "AgX", "Standard")
def_enum(scene.view_settings, "look",
         "Medium High Contrast", "AgX - Medium High Contrast",
         "Filmic - Medium High Contrast", "None")
print(f"Transformação de vista: {transform}")


# ------------------------------------------------------------------ materiais

def mat_agua():
    m = bpy.data.materials.new("Agua")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    def_entrada(bsdf, (0.9, 0.96, 1.0, 1.0), "Base Color")
    def_entrada(bsdf, 0.02, "Roughness")
    def_entrada(bsdf, 1.333, "IOR")
    def_entrada(bsdf, 1.0, "Transmission Weight", "Transmission")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    # Absorção volumétrica (tom verde-azulado da água real com profundidade)
    vol = nt.nodes.new("ShaderNodeVolumeAbsorption")
    def_entrada(vol, (0.36, 0.68, 0.75, 1.0), "Color")
    def_entrada(vol, 0.9, "Density")
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    return m


def mat_aco():
    m = bpy.data.materials.new("Aco")
    m.use_nodes = True
    b = principled(m.node_tree)
    def_entrada(b, (0.35, 0.37, 0.40, 1.0), "Base Color")
    def_entrada(b, 1.0, "Metallic")
    def_entrada(b, 0.35, "Roughness")
    return m


def mat_leito():
    m = bpy.data.materials.new("Leito")
    m.use_nodes = True
    nt = m.node_tree
    b = principled(nt)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    def_entrada(noise, 60.0, "Scale")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.05, 0.07, 0.06, 1)
    ramp.color_ramp.elements[1].color = (0.16, 0.15, 0.12, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    def_entrada(b, 0.9, "Roughness")
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
# 3.x/4.x: "NISHITA"; 5.x renomeou o modelo físico para os dois de
# espalhamento. Escolhe o mais próximo que existir nesta versão.
modelo = def_enum(sky, "sky_type", "NISHITA", "MULTIPLE_SCATTERING",
                  "SINGLE_SCATTERING", "HOSEK_WILKIE", "PREETHAM")
print(f"Modelo de céu: {modelo}")
def_prop(sky, "sun_elevation", math.radians(12))
def_prop(sky, "sun_rotation", math.radians(230))
def_prop(sky, "sun_intensity", 0.6)
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
    try:
        m2p = tree.nodes.new("GeometryNodeMeshToPoints")
        p2v = tree.nodes.new("GeometryNodePointsToVolume")
        v2m = tree.nodes.new("GeometryNodeVolumeToMesh")
    except RuntimeError as erro:
        raise SystemExit(
            "Esta versão do Blender não tem os nós Points→Volume→Mesh usados "
            f"para reconstruir a superfície da água ({erro}). Use uma versão "
            "3.6 ou 4.x, ou abra um chamado no projeto informando a versão."
        )
    setmat = tree.nodes.new("GeometryNodeSetMaterial")
    shade = tree.nodes.new("GeometryNodeSetShadeSmooth")

    r = CENA["raio_particula"]
    voxel = max(0.8 * r, 0.012)
    def_entrada(p2v, 1.7 * r, "Radius")
    def_enum(p2v, "resolution_mode", "VOXEL_SIZE", "VOXEL_AMOUNT")
    def_entrada(p2v, voxel, "Voxel Size")
    def_enum(v2m, "resolution_mode", "VOXEL_SIZE", "VOXEL_AMOUNT", "GRID")
    def_entrada(v2m, voxel, "Voxel Size")
    def_entrada(setmat, M_AGUA, "Material")

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


for n in range(ini, fim + 1, ARGS["passo"]):
    nome = f"quadro_{n:04d}.ply"
    if nome not in quadros:
        print(f"[aviso] {nome} não existe; pulando")
        continue
    montar_agua(os.path.join(DIR, nome))
    scene.render.filepath = os.path.join(DIR, "render", f"quadro_{n:04d}.png")
    print(f"Renderizando {nome} → {scene.render.filepath}")
    render_still()

print("Concluído.")
