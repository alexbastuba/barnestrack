import { describe, expect, it } from 'vitest';
import {
  BitReader,
  derivePictureOrder,
  parseAvcC,
  parseSps,
  unescapeRbsp,
  type AvcDecoderConfig,
  type SliceInfo,
} from '../../src/video/h264-poc.js';

/** Packs a bit string like '1 010 00111' into bytes (MSB first), zero-padded. */
function bits(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '');
  const out = new Uint8Array(Math.ceil(clean.length / 8));
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '1') out[i >> 3] = (out[i >> 3] ?? 0) | (0x80 >> (i & 7));
  }
  return out;
}

describe('BitReader', () => {
  it('reads fixed-width fields MSB first', () => {
    const r = new BitReader(bits('1011 0001 1111 0000'));
    expect(r.u(4)).toBe(0b1011);
    expect(r.u(4)).toBe(0b0001);
    expect(r.u(8)).toBe(0b11110000);
    expect(r.bitsLeft).toBe(0);
    expect(() => r.u(1)).toThrow(RangeError);
  });

  it('decodes unsigned and signed Exp-Golomb codes', () => {
    // ue: 1 → 0, 010 → 1, 011 → 2, 00100 → 3, 00111 → 6, 0001000 → 7
    const r = new BitReader(bits('1 010 011 00100 00111 0001000'));
    expect([r.ue(), r.ue(), r.ue(), r.ue(), r.ue(), r.ue()]).toEqual([0, 1, 2, 3, 6, 7]);
    // se: codeNum 1 → +1, 2 → −1, 3 → +2, 4 → −2
    const s = new BitReader(bits('010 011 00100 00101'));
    expect([s.se(), s.se(), s.se(), s.se()]).toEqual([1, -1, 2, -2]);
  });
});

describe('unescapeRbsp', () => {
  it('drops the emulation-prevention byte after two zeros', () => {
    const nal = new Uint8Array([0x00, 0x00, 0x03, 0x01, 0x00, 0x00, 0x03, 0x00, 0x00, 0x03]);
    expect(Array.from(unescapeRbsp(nal))).toEqual([0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
  });

  it('keeps a 0x03 that does not follow two zeros and honours maxBytes', () => {
    const nal = new Uint8Array([0x01, 0x03, 0x00, 0x03, 0x00, 0x00, 0x03, 0x03]);
    expect(Array.from(unescapeRbsp(nal))).toEqual([0x01, 0x03, 0x00, 0x03, 0x00, 0x00, 0x03]);
    expect(Array.from(unescapeRbsp(nal, 3))).toEqual([0x01, 0x03, 0x00]);
  });
});

describe('parseSps', () => {
  it('reads a baseline-profile SPS (no chroma block) up to frame_mbs_only_flag', () => {
    // profile 66, flags 0, level 30, sps_id 0, log2_max_frame_num_minus4 = 1,
    // poc_type 0, log2_max_poc_lsb_minus4 = 2, max_num_ref_frames 1, gaps 0,
    // width_mbs_minus1 3, height_minus1 3, frame_mbs_only 1
    // (ue codes: 0 → 1, 1 → 010, 2 → 011, 3 → 00100)
    const rbsp = bits('01000010 00000000 00011110 1 010 1 011 010 0 00100 00100 1');
    const sps = parseSps(rbsp);
    expect(sps).toMatchObject({
      spsId: 0,
      profileIdc: 66,
      separateColourPlane: false,
      log2MaxFrameNum: 5,
      pocType: 0,
      log2MaxPocLsb: 6,
      frameMbsOnly: true,
    });
  });
});

describe('parseAvcC', () => {
  it('extracts length size, SPS and PPS ids from an avcC payload', () => {
    const spsRbsp = bits('01000010 00000000 00011110 1 010 1 011 010 0 00100 00100 1');
    const spsNal = new Uint8Array([0x67, ...spsRbsp]);
    const ppsNal = new Uint8Array([0x68, ...bits('1 1 1 1')]); // pps_id 0, sps_id 0, ...
    const avcC = new Uint8Array([
      1, 66, 0, 30, 0xff, 0xe1, 0, spsNal.length, ...spsNal, 1, 0, ppsNal.length, ...ppsNal,
    ]);
    const cfg = parseAvcC(avcC);
    expect(cfg.lengthSize).toBe(4);
    expect(cfg.sps.get(0)?.log2MaxPocLsb).toBe(6);
    expect(cfg.pps.get(0)).toBe(0);
  });
});

describe('derivePictureOrder', () => {
  const cfg: AvcDecoderConfig = {
    lengthSize: 4,
    sps: new Map([
      [0, {
        spsId: 0, profileIdc: 100, separateColourPlane: false, log2MaxFrameNum: 6,
        pocType: 0, log2MaxPocLsb: 4, frameMbsOnly: true,
      }],
    ]),
    pps: new Map([[0, 0]]),
  };
  const slice = (partial: Partial<SliceInfo>): SliceInfo => ({
    nalUnitType: 1, nalRefIdc: 2, isIdr: false, frameNum: 0, fieldPic: false, pocLsb: 0, spsId: 0,
    ...partial,
  });

  it('orders a B-pyramid mini-GOP by POC, restarts at IDR and unwraps the lsb counter', () => {
    // MaxPicOrderCntLsb = 32 (log2 = 5); consecutive reference pictures move by less than
    // half the range except at the deliberate wrap. Decode order, (lsb, ref) per picture:
    // IDR(0) P(6) B-ref(2) b(4, non-ref) P(12) B-ref(8) P(18) B(14) P(24) B(20) P(30) B(26)
    // P(4 → wrapped, 36) b(30, non-ref → belongs before the wrap, 30) IDR(gop 1) P(2)
    const cfg32: AvcDecoderConfig = {
      ...cfg,
      sps: new Map([[0, { ...cfg.sps.get(0)!, log2MaxPocLsb: 5 }]]),
    };
    const slices = [
      slice({ isIdr: true, nalUnitType: 5, pocLsb: 0 }),
      slice({ pocLsb: 6 }),
      slice({ pocLsb: 2 }),
      slice({ pocLsb: 4, nalRefIdc: 0 }),
      slice({ pocLsb: 12 }),
      slice({ pocLsb: 8 }),
      slice({ pocLsb: 18 }),
      slice({ pocLsb: 14 }),
      slice({ pocLsb: 24 }),
      slice({ pocLsb: 20 }),
      slice({ pocLsb: 30 }),
      slice({ pocLsb: 26 }),
      slice({ pocLsb: 4 }),
      slice({ pocLsb: 30, nalRefIdc: 0 }),
      slice({ isIdr: true, nalUnitType: 5, pocLsb: 0 }),
      slice({ pocLsb: 2 }),
    ];
    const result = derivePictureOrder(slices, cfg32);
    expect(result.order).toEqual([
      { gop: 0, poc: 0 },
      { gop: 0, poc: 6 },
      { gop: 0, poc: 2 },
      { gop: 0, poc: 4 },
      { gop: 0, poc: 12 },
      { gop: 0, poc: 8 },
      { gop: 0, poc: 18 },
      { gop: 0, poc: 14 },
      { gop: 0, poc: 24 },
      { gop: 0, poc: 20 },
      { gop: 0, poc: 30 },
      { gop: 0, poc: 26 },
      { gop: 0, poc: 36 },
      { gop: 0, poc: 30 },
      { gop: 1, poc: 0 },
      { gop: 1, poc: 2 },
    ]);
  });

  it('refuses field-coded pictures and POC type 1 explicitly', () => {
    expect(derivePictureOrder([slice({ fieldPic: true })], cfg)).toMatchObject({ order: null });
    const cfg1: AvcDecoderConfig = {
      ...cfg,
      sps: new Map([[0, { ...cfg.sps.get(0)!, pocType: 1 }]]),
    };
    expect(derivePictureOrder([slice({ pocLsb: null })], cfg1)).toMatchObject({
      order: null,
      reason: expect.stringContaining('type 1'),
    });
  });

  it('uses decode order for POC type 2', () => {
    const cfg2: AvcDecoderConfig = {
      ...cfg,
      sps: new Map([[0, { ...cfg.sps.get(0)!, pocType: 2 }]]),
    };
    const result = derivePictureOrder([slice({ pocLsb: null }), slice({ pocLsb: null })], cfg2);
    expect(result.order).toEqual([{ gop: 0, poc: 0 }, { gop: 0, poc: 1 }]);
  });
});
