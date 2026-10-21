# NeoV8 firmware build: ca65/ld65 -> build/neov8.bin (32K, $8000-$FFFF) + 4 EPROM images (2764/27C64/28C64)
AS = ca65
LD = ld65
BUILD ?= build
MAIN ?= src/main.s
DEFS ?=
OBJ = $(BUILD)/main.o
INC = $(wildcard src/*.inc) $(wildcard src/*.asm) $(wildcard src/*/*.asm) $(wildcard src/*/*.inc) $(wildcard test/*.asm) $(wildcard src/stubs/*) gen/rev4-tables.inc Makefile

all: $(BUILD)/neov8.bin $(BUILD)/neov8-8000.bin size

# Always reassemble (well under a second): the stub/define set of a bench may change between runs.
.PHONY: $(OBJ)
$(OBJ): | $(BUILD)
	$(AS) --cpu 6502 -g $(DEFS) -I src -I . -l $(@:.o=.lst) -o $@ $(MAIN)

$(BUILD)/neov8.bin: $(OBJ) v8.cfg
	$(LD) -C v8.cfg -m $(BUILD)/neov8.map -Ln $(BUILD)/neov8.lbl -o $@ $(OBJ)

gen/rev4-tables.inc:
	node ../tools/extract-tables.mjs

# chip images: U-CS4 $8000, U-CS5 $A000, U-CS6 $C000, U-CS7 $E000
$(BUILD)/neov8-8000.bin: $(BUILD)/neov8.bin
	dd if=$< of=$(BUILD)/neov8-8000.bin bs=8192 skip=0 count=1 2>/dev/null
	dd if=$< of=$(BUILD)/neov8-A000.bin bs=8192 skip=1 count=1 2>/dev/null
	dd if=$< of=$(BUILD)/neov8-C000.bin bs=8192 skip=2 count=1 2>/dev/null
	dd if=$< of=$(BUILD)/neov8-E000.bin bs=8192 skip=3 count=1 2>/dev/null

size: $(BUILD)/neov8.bin
	@grep -E '^(ZEROPAGE|BSS|CODE|RODATA|VECTORS) ' $(BUILD)/neov8.map | awk '{print "  " $$1 " size $$" $$4}'
	@used=$$(LC_ALL=C tr -d '\377' < $(BUILD)/neov8.bin | wc -c | tr -d ' '); echo "  ROM used (non-FF bytes): $$used / 32768"

$(BUILD):
	mkdir -p $(BUILD)

clean:
	rm -rf build build-*

.PHONY: all size clean
