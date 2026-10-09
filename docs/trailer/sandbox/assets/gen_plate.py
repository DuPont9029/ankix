import json, os, sys
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
W,H=1200,800
labels=[
 ("Afferent arteriole", 40, 70, 300, (140,233)),
 ("Glomerulus", 40, 420, 190, (215,265)),
 ("Bowman's capsule", 330, 600, 300, (300,300)),
 ("Proximal convoluted tubule", 360, 40, 420, (432,310)),
 ("Loop of Henle", 640, 720, 230, (640,660)),
 ("Distal convoluted tubule", 790, 120, 370, (868,212)),
 ("Collecting duct", 712, 470, 236, (952,494)),
]
boxes=[]
svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
 '<rect width="1200" height="800" fill="#fbf8f1"/>',
 '<text x="40" y="780" font-family="Georgia" font-size="18" fill="#8a7f6a">Plate 12 — The nephron (diagram)</text>',
 '<path d="M60 230 C 130 230, 160 240, 205 255" stroke="#b5483e" stroke-width="16" fill="none" stroke-linecap="round"/>',
 '<path d="M265 250 C 300 235, 330 200, 350 160" stroke="#b5483e" stroke-width="12" fill="none" stroke-linecap="round" opacity=".85"/>',
 '<circle cx="245" cy="275" r="78" fill="#e4f1ee" stroke="#0f5b5c" stroke-width="7"/>',
 '<g fill="#c0564b"><circle cx="228" cy="262" r="20"/><circle cx="262" cy="255" r="18"/><circle cx="246" cy="290" r="20"/><circle cx="272" cy="286" r="14"/><circle cx="222" cy="295" r="13"/></g>',
 '<path d="M318 300 C 380 240, 420 360, 480 290 S 560 220, 590 320 L 590 640 C 590 710, 690 710, 690 640 L 690 360 C 690 290, 760 310, 780 250 S 880 200, 965 240" stroke="#0f5b5c" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>',
 '<path d="M965 120 L 965 700" stroke="#0f5b5c" stroke-width="30" stroke-linecap="round" opacity=".55"/>',
]
for t,x,y,w,(px,py) in labels:
    h=48
    ax = min(max(px, x), x+w); ay = y+h if py > y+h else (y if py < y else py)
    if y <= py <= y+h: ax = x if px < x else x+w
    svg.append(f'<line x1="{ax}" y1="{ay}" x2="{px}" y2="{py}" stroke="#3f4948" stroke-width="2"/><circle cx="{px}" cy="{py}" r="5" fill="#3f4948"/>')
    svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="#fffdf8" stroke="#cfc6b3" stroke-width="1.5"/>')
    svg.append(f'<text x="{x+w/2}" y="{y+33}" text-anchor="middle" font-family="Georgia" font-size="27" fill="#1f2a29">{t}</text>')
    boxes.append({"label":t,"box_2d":[round(y/H*1000),round(x/W*1000),round((y+h)/H*1000),round((x+w)/W*1000)]})
svg.append('</svg>')
open(os.path.join(OUT,'nephron.svg'),'w').write('\n'.join(svg))
json.dump(boxes, open(os.path.join(OUT,'nephron-boxes.json'),'w'), ensure_ascii=False, indent=1)
