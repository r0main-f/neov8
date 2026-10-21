"""Routine catalogue: for every JSR target / jump-table entry, walk its body (branches + JMP within
the routine, not into JSR callees) and summarise callers, callees, I/O and RAM regions touched.
Usage: catalog.py rom.bin trace.json entries.txt out.tsv"""
import sys, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from op6502 import OPS, LEN, CYC
rom = open(sys.argv[1],'rb').read(); d = json.load(open(sys.argv[2]))
B=0x8000
def rb(a): return rom[a-B]
def rw(a): return rb(a)|rb(a+1)<<8
insn=set(d['insn'])
calls={int(k):v for k,v in d['calls'].items()}
jt=[]
for line in open(sys.argv[3]):
    p=line.split('#')[0].split()
    if p and p[0] in('JT','JT4'):
        a=int(p[1],16); s=3 if p[0]=='JT' else 4
        for i in range(int(p[2])): jt.append((a+s*i, rw(a+s*i+1)))
roots={}
for t,c in calls.items(): roots.setdefault(t,set()).update(f'C{x:04X}' for x in c)
for slot,t in jt: roots.setdefault(t,set()).add(f'T{slot:04X}')
for v,n in ((0xFFFA,'NMI'),(0xFFFC,'RESET'),(0xFFFE,'IRQ')): roots.setdefault(rw(v),set()).add(n)
def region(a):
    if a<0x100: return 'zp'
    if a<0x200: return 'stack'
    if a<0x2000: return 'ram'
    if a<0x2800: return '8279'
    if a<0x3000: return 'potpanel'
    if a<0x3800: return 'S&H'
    if a<0x4000: return 'ACIA'
    if a<0x6000: return 'BATT'
    if a<0x6800: return 'strobe6xxx'
    if a<0x6A00: return 'PIA1'
    if a<0x6C00: return 'PIA2'
    if a<0x6D00: return 'PTM'
    if a<0x7000: return '6Dxx'
    if a<0x8000: return '7xxx'
    return 'ROM'
rows=[]
for r in sorted(roots):
    if r not in insn: continue
    seen=set(); work=[r]; io=set(); batt=set(); callees=set(); size=0; tail=set()
    while work:
        pc=work.pop()
        while pc in insn and pc not in seen and (pc==r or pc not in roots or True):
            if pc!=r and pc in roots and pc not in seen and len(seen)>0 and pc in calls: 
                tail.add(pc); break
            seen.add(pc); m,md=OPS[rb(pc)]; n=LEN[md]
            if md in('abs','abx','aby'):
                t=rw(pc+1); g=region(t)
                if m=='JSR': callees.add(t)
                elif g not in('ROM','ram','zp'): io.add(g if g!='BATT' else 'BATT'); 
                if g=='BATT' and m!='JSR': batt.add(t)
            if md=='ind': io.add('JMPIND')
            if m=='JMP' and md=='abs':
                t=rw(pc+1)
                if t in roots and t!=r: tail.add(t); break
                pc=t; continue
            if m in('RTS','RTI','BRK') or (m=='JMP'): break
            if md=='rel':
                o=rb(pc+1); o=o-256 if o>127 else o; work.append(pc+2+o)
            pc+=n
    rows.append((r,len(seen),sorted(roots[r]),sorted(callees),sorted(io),sorted(batt),sorted(tail)))
with open(sys.argv[4],'w') as f:
    f.write('addr\tninsn\trefs\tcallees\tio\tbatt\ttailjumps\n')
    for r,n,refs,ce,io,bt,tl in rows:
        f.write(f"{r:04X}\t{n}\t{' '.join(refs[:8])}{' +'+str(len(refs)-8) if len(refs)>8 else ''}\t{' '.join('%04X'%c for c in ce)}\t{','.join(io)}\t{' '.join('%04X'%b for b in bt[:10])}\t{' '.join('%04X'%t for t in tl)}\n")
print(len(rows),'routines')
