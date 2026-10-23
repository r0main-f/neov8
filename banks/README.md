# Sound banks

`voyetra-factory-b2.syx` holds the Octave-Plateau factory bank of the Voyetra Eight Rev4: the 100 programs, 100
steps and the velocity-taper / footswitch block of factory cassette B2. It was decoded from a recording of that
cassette with NeoV8's tape reader (the stock ROM's format, `engine/crates/v8-plugin/src/bank.rs`) and written as
the Rev4's own SysEx dumps, byte-identical to what the stock ROM sends.

- **NeoV8 app and plugin:** built in; loaded on a first start (fresh battery RAM). LOAD BANK reloads it.
- **A real Voyetra Eight** (stock Rev4 or NeoV8), with SysEx receive on: send the file from any SysEx tool. The
  messages carry the controller flag, so the instrument stores them (memory protect off). Each program and step is
  acknowledged; it overwrites programs 00-99, steps 00-99 and the taper / footswitch settings.

The bank is Octave-Plateau's original sound data, included as is. It is not covered by NeoV8's licenses
(GPL-3.0 / CC BY-SA 4.0); its rights belong to their owners. If you hold those
rights and want it removed, open an issue.
