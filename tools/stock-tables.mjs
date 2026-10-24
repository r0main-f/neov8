// The stock Rev4 tables the parity builds take from your own ROM dump (tools/extract-tables.mjs): addresses only, no
// ROM data, so tests can list them without the dump.
// label, ROM address, length, comment  (addresses: docs/hardware.md §10, docs/rev4-disasm-notes.md)
export const STOCK_TABLES = [
  ['tb_env_pa0', 0xd000, 256, 'envelope level -> 14-bit DAC curve, PA byte, fraction 00'],
  ['tb_env_pb0', 0xd100, 256, '... PB byte, fraction 00'],
  ['tb_env_pa1', 0xd200, 256, 'fraction 01'],
  ['tb_env_pb1', 0xd300, 256, ''],
  ['tb_env_pa2', 0xd400, 256, 'fraction 10'],
  ['tb_env_pb2', 0xd500, 256, ''],
  ['tb_env_pa3', 0xd600, 256, 'fraction 11'],
  ['tb_env_pb3', 0xd700, 256, ''],
  ['tb_env_inv', 0xd800, 256, 'inverse envelope curve (index level*2)'],
  ['tb_param_curve', 0xd900, 256, 'convex 0..255 parameter curve (index param*2): glide, program volume'],
  ['tb_adsr_rate_hi', 0x8800, 128, 'ADSR rate, high byte, per 7-bit time parameter'],
  ['tb_adsr_rate_lo', 0x8880, 128, 'ADSR rate, low byte'],
  ['tb_wave_comp', 0xdee1, 3, 'waveform-mix level compensation steps'],
  ['tb_tempo_t1', 0xb66d, 236, 'tempo -> PTM T1 MSB'],
  ['tb_taper_fact', 0xbe20, 96, 'factory velocity tapers 1-3 (32 key speeds each)'],
  ['tb_vel_vca', 0xbe80, 128, 'velocity -> VCA multiplier curve'],
  ['tb_vel_mod', 0xbf00, 128, 'velocity -> modulation velocity curve'],
  ['tb_vel_att', 0xbf80, 128, 'velocity -> attack-rate offset curve'],
];
