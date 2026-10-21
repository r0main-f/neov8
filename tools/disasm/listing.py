"""Compact annotated listing with xrefs. Usage: listing.py rom.bin trace.json out.lst ann1.info [ann2.info ...]"""
import sys, json, re, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from op6502 import OPS, LEN
rom = open(sys.argv[1],'rb').read(); d = json.load(open(sys.argv[2])); ann = '\n'.join(open(p).read() for p in sys.argv[4:])
B=0x8000
def rb(a): return rom[a-B]
def rw(a): return rb(a)|rb(a+1)<<8
names = {}; cmts = {}
for m in re.finditer(r'LABEL\s*\{([^}]*)\}', ann):
    b = m.group(1)
    n = re.search(r'NAME\s+"([^"]+)"', b).group(1); a = int(re.search(r'ADDR\s+\$([0-9A-Fa-f]+)', b).group(1),16)
    sz = re.search(r'SIZE\s+(\d+)', b); sz = int(sz.group(1)) if sz else 1
    c = re.search(r'COMMENT\s+"([^"]*)"', b)
    for i in range(sz): names[a+i] = n if i==0 else f'{n}+{i}'
    if c: cmts[a] = c.group(1)
insn = set(d['insn']); xref = {}
for a in insn:
    op = rb(a); m, md = OPS[op]
    if md in ('abs','ind') and m in ('JSR','JMP'): xref.setdefault(rw(a+1), []).append(('J' if m=='JMP' else 'C', a))
    if md=='rel':
        o=rb(a+1); o=o-256 if o>127 else o; xref.setdefault(a+2+o, []).append(('B', a))
for a in insn:
    m, md = OPS[rb(a)]
    if md in ('abs','abx','aby') and m not in ('JSR','JMP') and a>=0: 
        t=rw(a+1)
        if t>=B: xref.setdefault(t, []).append(('D', a))
def nm(t, zp=False):
    if t in names: return names[t]
    if t >= B and t in xref: return f'L{t:04X}'
    return f'${t:02X}' if zp else f'${t:04X}'
out = []
a = B
while a <= 0xFFFF:
    if a in xref or a in names:
        xs = xref.get(a, [])
        lab = names.get(a, f'L{a:04X}')
        callers = ' '.join(f'{k}{s:04X}' for k,s in sorted(xs, key=lambda x:x[1])[:12]) + (' ...' if len(xs)>12 else '')
        out.append(f'{lab}:' + (f'   ; <- {callers}' if callers else '') + (f'  ; {cmts[a]}' if a in cmts else ''))
    if a in insn:
        op = rb(a); m, md = OPS[op]; n = LEN[md]
        bs = ' '.join(f'{rb(a+i):02X}' for i in range(n))
        if md=='imp': o=''
        elif md=='acc': o='A'
        elif md=='imm': o=f'#${rb(a+1):02X}'
        elif md=='zp': o=nm(rb(a+1),1)
        elif md=='zpx': o=nm(rb(a+1),1)+',X'
        elif md=='zpy': o=nm(rb(a+1),1)+',Y'
        elif md=='abs': o=nm(rw(a+1))
        elif md=='abx': o=nm(rw(a+1))+',X'
        elif md=='aby': o=nm(rw(a+1))+',Y'
        elif md=='ind': o='('+nm(rw(a+1))+')'
        elif md=='izx': o='('+nm(rb(a+1),1)+',X)'
        elif md=='izy': o='('+nm(rb(a+1),1)+'),Y'
        elif md=='rel':
            off=rb(a+1); off=off-256 if off>127 else off; o=nm(a+2+off)
        line = f'{a:04X} {bs:9s} {m} {o}'
        if md in ('abs','abx','aby') and rw(a+1) in cmts and rw(a+1) < B: line += f'   ; {cmts[rw(a+1)]}'
        out.append(line); 
        if m in ('RTS','RTI','JMP'): out.append('')
        a += n
    else:
        s = a; bs=[]
        while a <= 0xFFFF and a not in insn and len(bs) < 16 and (a==s or (a not in xref and a not in names)):
            bs.append(rb(a)); a += 1
        out.append(f'{s:04X} .byte ' + ' '.join(f'{x:02X}' for x in bs) + '   |' + ''.join(chr(x) if 32<=x<127 else '.' for x in bs))
open(sys.argv[3],'w').write('\n'.join(out)+'\n')
