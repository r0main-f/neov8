# Voyetra Eight Rev4 ROM disassembly. Usage: make -C tools/disasm   (needs cc65's da65, python3, node)
ROM      := ../rom/build/rev4.bin
ANN      := $(sort $(wildcard ann/*.info))
PY       := python3 -I

all: build/rev4.s build/rev4.lst

$(ROM):
	node ../rom/extract-roms.mjs

build/rev4.json: $(ROM) entries.txt trace.py op6502.py
	@mkdir -p build
	$(PY) trace.py $(ROM) entries.txt build/rev4

rev4.info: build/rev4.json $(ANN) gen-info.py
	$(PY) gen-info.py $(ROM) build/rev4.json $@ $(ANN)

build/rev4.s: rev4.info $(ROM)
	da65 -i rev4.info -o $@

build/rev4.lst: build/rev4.json $(ANN) listing.py
	$(PY) listing.py $(ROM) build/rev4.json $@ $(ANN)

# Reassemble build/rev4.s with ca65/ld65 and compare with the original image.
verify: build/rev4.s
	printf 'MEMORY { ROM: start=$$8000, size=$$8000, fill=yes; }\nSEGMENTS { CODE: load=ROM, type=ro; }\n' > build/rt.cfg
	ca65 -o build/rt.o build/rev4.s
	ld65 -C build/rt.cfg -o build/rt.bin build/rt.o
	cmp build/rt.bin $(ROM) && echo "verify: reassembly is byte-identical"

clean:
	rm -rf build

.PHONY: all clean verify
