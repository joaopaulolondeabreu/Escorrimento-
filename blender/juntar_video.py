# -*- coding: utf-8 -*-
"""
Junta os quadros renderizados num vídeo MP4 usando o próprio Blender —
assim não é preciso instalar mais nada (o ffmpeg vem embutido nele).

Uso:

    blender -b -P blender/juntar_video.py -- exports/render
    blender -b -P blender/juntar_video.py -- exports/render 12 captacao.mp4

Argumentos posicionais: pasta dos PNG, taxa de quadros (padrão 24) e nome
do arquivo de saída (padrão: captacao.mp4 dentro da pasta).

Funciona com numeração salteada (quadro_0001, 0003, 0005…), como a que o
parâmetro --passo produz: os arquivos são listados um a um, em ordem.
"""

import bpy
import os
import re
import sys

argv = sys.argv
argv = argv[argv.index("--") + 1:] if "--" in argv else []
pasta = os.path.abspath(argv[0] if len(argv) >= 1 else "exports/render")
fps = float(argv[1]) if len(argv) >= 2 else 24.0
saida = argv[2] if len(argv) >= 3 else os.path.join(pasta, "captacao.mp4")

quadros = sorted(f for f in os.listdir(pasta) if re.fullmatch(r".+\.png", f))
if not quadros:
    raise SystemExit(f"Nenhum PNG em {pasta} — renderize os quadros antes.")
print(f"{len(quadros)} quadros, {fps} por segundo → {saida}")

scene = bpy.context.scene
scene.render.fps = int(round(fps))
scene.render.fps_base = scene.render.fps / fps      # aceita fps fracionário
scene.frame_start = 1
scene.frame_end = len(quadros)

# As imagens já saíram com a transformação de vista aplicada; aplicar de novo
# lavaria as cores. "Standard" repassa os pixels como estão.
try:
    scene.view_settings.view_transform = "Standard"
except (TypeError, ValueError):
    print("[aviso] não consegui usar a transformação Standard")

se = scene.sequence_editor_create()
# Blender ≥ 4.4 renomeou "sequences" para "strips". A checagem é por
# existência do atributo, não por verdade: a coleção recém-criada está
# vazia, e coleção vazia é falsa — um "or" aqui cairia no nome antigo.
colecao = se.strips if hasattr(se, "strips") else se.sequences
faixa = colecao.new_image(
    name="quadros", filepath=os.path.join(pasta, quadros[0]),
    channel=1, frame_start=1,
)
for nome in quadros[1:]:
    faixa.elements.append(nome)

# resolução = a das próprias imagens
img = bpy.data.images.load(os.path.join(pasta, quadros[0]))
scene.render.resolution_x, scene.render.resolution_y = img.size
scene.render.resolution_percentage = 100

# No Blender 5.x o vídeo virou um "tipo de mídia" à parte: é preciso mudar
# media_type antes, senão FFMPEG nem aparece entre os formatos possíveis.
imagens = scene.render.image_settings
if hasattr(imagens, "media_type"):
    imagens.media_type = "VIDEO"
try:
    imagens.file_format = "FFMPEG"
except (TypeError, ValueError):
    print(f"[aviso] formato de saída ficou em {imagens.file_format}")
scene.render.ffmpeg.format = "MPEG4"
scene.render.ffmpeg.codec = "H264"
scene.render.ffmpeg.constant_rate_factor = "HIGH"
scene.render.ffmpeg.ffmpeg_preset = "GOOD"
scene.render.ffmpeg.audio_codec = "NONE"
scene.render.filepath = saida
# o Blender acrescenta a numeração se o caminho não terminar em extensão
scene.render.use_file_extension = False

bpy.ops.render.render(animation=True)
print(f"Vídeo pronto: {saida}")
