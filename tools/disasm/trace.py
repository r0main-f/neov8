"""Recursive-descent code tracer for the Voyetra Eight ROM ($8000-$FFFF).
Usage: python3 -I trace.py rom.bin entries.txt out_prefix
entries.txt: lines "ADDR [comment]" (hex) of extra code entry points; lines "JT ADDR N" = N-entry JMP table.
Lines "ATAB lo hi n" = address table split lo/hi bytes (n entries) whose targets are code (value+1 if 'RTS').
Writes out_prefix.code (instruction starts), out_prefix.json (coverage, refs)."""
import sys, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from op6502 import OPS, LEN

rom = open(sys.argv[1], 'rb').read()
BASE = 0x8000
def rb(a): return rom[a - BASE]
def rw(a): return rb(a) | (rb(a+1) << 8)
def inrom(a): return BASE <= a <= 0xFFFF

entries = []
for line in open(sys.argv[2]):
    line = line.split('#')[0].strip()
    if not line: continue
    p = line.split()
    if p[0] == 'JT':
        a = int(p[1], 16); n = int(p[2])
        for i in range(n):
            assert rb(a+3*i) == 0x4C, hex(a+3*i)
            entries.append(a + 3*i)
    elif p[0] == 'JT4':  # JMP abs + NOP, 4-byte stride
        a = int(p[1], 16); n = int(p[2])
        for i in range(n):
            assert rb(a+4*i) == 0x4C, hex(a+4*i)
            entries.append(a + 4*i)
    elif p[0] == 'WTAB':  # little-endian word table of code addresses
        a = int(p[1],16); n=int(p[2]); add = int(p[3]) if len(p)>3 else 0
        for i in range(n): entries.append(rw(a+2*i)+add)
    elif p[0] == 'SPLIT':  # lo table, hi table, n, add
        lo=int(p[1],16); hi=int(p[2],16); n=int(p[3]); add=int(p[4]) if len(p)>4 else 0
        for i in range(n): entries.append((rb(lo+i)|(rb(hi+i)<<8))+add)
    else:
        entries.append(int(p[0], 16))
for v in (0xFFFA, 0xFFFC, 0xFFFE): entries.append(rw(v))

insn = {}      # addr -> (op, len)
owner = {}     # byte addr -> insn addr
indirect = []
refs = {}      # target -> list of [pc, mnem, mode]
calls = {}     # jsr target -> callers
conflicts = []
work = list(entries)
while work:
    pc = work.pop()
    while True:
        if not inrom(pc): break
        if pc in insn: break
        op = rb(pc)
        if op not in OPS:
            conflicts.append(('badop', pc)); break
        m, md = OPS[op]; n = LEN[md]
        clash = [b for b in range(pc, pc+n) if b in owner]
        if clash:
            conflicts.append(('overlap', pc, owner[clash[0]])); break
        insn[pc] = (op, n)
        for b in range(pc, pc+n): owner[b] = pc
        nxt = pc + n
        if md in ('abs','abx','aby','ind'):
            t = rw(pc+1)
            refs.setdefault(t, []).append([pc, m, md])
        elif md in ('zp','zpx','zpy','izx','izy'):
            t = rb(pc+1)
            refs.setdefault(t, []).append([pc, m, md])
        if m == 'JMP' and md == 'abs':
            pc = rw(pc+1); continue
        if m == 'JMP' and md == 'ind':
            indirect.append(pc); break
        if m == 'JSR':
            t = rw(pc+1); calls.setdefault(t, []).append(pc); work.append(t)
            pc = nxt; continue
        if md == 'rel':
            off = rb(pc+1); off = off - 256 if off >= 128 else off
            work.append(nxt + off); pc = nxt; continue
        if m in ('RTS','RTI','BRK'): break
        pc = nxt

code = bytearray(0x8000)
for a,(op,n) in insn.items():
    for b in range(a, a+n): code[b-BASE] = 1
ranges = []
start = None
for i in range(0x8000):
    if code[i] and start is None: start = i
    if not code[i] and start is not None: ranges.append((start+BASE, i-1+BASE)); start=None
if start is not None: ranges.append((start+BASE, 0xFFFF))
json.dump({'ranges': ranges, 'insn': sorted(insn), 'indirect': indirect,
           'refs': {str(k): v for k,v in refs.items()}, 'calls': {str(k): v for k,v in calls.items()},
           'conflicts': conflicts, 'entries': sorted(set(entries))}, open(sys.argv[3]+'.json','w'))
print('code bytes', sum(code), 'ranges', len(ranges), 'indirect', [hex(x) for x in indirect])
print('conflicts', [(c[0],)+tuple(hex(x) for x in c[1:]) for c in conflicts][:60])
