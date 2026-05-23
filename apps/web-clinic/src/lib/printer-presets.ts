// Ommabop termal chek printerlar uchun preset ro'yxati.
// Tanlanganda forma maydonlari (paper_width, has_cutter, encoding, VID/PID)
// avtomatik to'ldiriladi. Ulanish ma'lumotini (IP/MAC) baribir foydalanuvchi kiritadi.

export type PrinterPreset = {
  key: string;
  brand: string;
  model: string;
  paper_width_mm: 58 | 80;
  has_cutter: boolean;
  encoding: 'CP1251' | 'UTF-8' | 'CP866';
  recommended_connection: 'lan' | 'usb' | 'bluetooth';
  usb_vendor_id?: string;
  usb_product_id?: string;
  recommended: boolean;
  notes: string;
};

export const PRINTER_PRESETS: PrinterPreset[] = [
  {
    key: 'epson_tm_t20iii',
    brand: 'Epson',
    model: 'TM-T20III',
    paper_width_mm: 80,
    has_cutter: true,
    encoding: 'CP1251',
    recommended_connection: 'lan',
    usb_vendor_id: '04b8',
    usb_product_id: '0e15',
    recommended: true,
    notes: 'Eng barqaror, sanoat standarti. LAN/USB.',
  },
  {
    key: 'epson_tm_t20x',
    brand: 'Epson',
    model: 'TM-T20X',
    paper_width_mm: 80,
    has_cutter: true,
    encoding: 'CP1251',
    recommended_connection: 'lan',
    usb_vendor_id: '04b8',
    usb_product_id: '0e28',
    recommended: true,
    notes: 'LAN/USB, ishonchli.',
  },
  {
    key: 'xprinter_xp_n160ii',
    brand: 'Xprinter',
    model: 'XP-N160II',
    paper_width_mm: 80,
    has_cutter: true,
    encoding: 'CP1251',
    recommended_connection: 'lan',
    recommended: true,
    notes: "O'zbekistonda eng ommabop, LAN.",
  },
  {
    key: 'xprinter_xp_t80a',
    brand: 'Xprinter',
    model: 'XP-T80A',
    paper_width_mm: 80,
    has_cutter: true,
    encoding: 'CP1251',
    recommended_connection: 'lan',
    usb_vendor_id: '1fc9',
    usb_product_id: '2016',
    recommended: false,
    notes: 'Arzon, USB/LAN.',
  },
  {
    key: 'xprinter_xp_q800',
    brand: 'Xprinter',
    model: 'XP-Q800',
    paper_width_mm: 80,
    has_cutter: true,
    encoding: 'CP1251',
    recommended_connection: 'usb',
    usb_vendor_id: '1fc9',
    usb_product_id: '2016',
    recommended: false,
    notes: 'USB/LAN/BT.',
  },
  {
    key: 'xprinter_xp_58iih',
    brand: 'Xprinter',
    model: 'XP-58IIH',
    paper_width_mm: 58,
    has_cutter: false,
    encoding: 'CP1251',
    recommended_connection: 'usb',
    usb_vendor_id: '1fc9',
    usb_product_id: '2016',
    recommended: false,
    notes: 'Kichik, arzon, navbat uchun.',
  },
  {
    key: 'rongta_rp80',
    brand: 'Rongta',
    model: 'RP80',
    paper_width_mm: 80,
    has_cutter: true,
    encoding: 'CP1251',
    recommended_connection: 'lan',
    usb_vendor_id: '0fe6',
    usb_product_id: '811e',
    recommended: false,
    notes: 'Arzon segment.',
  },
  {
    key: 'rongta_rp58',
    brand: 'Rongta',
    model: 'RP58',
    paper_width_mm: 58,
    has_cutter: false,
    encoding: 'CP1251',
    recommended_connection: 'usb',
    usb_vendor_id: '0fe6',
    usb_product_id: '811e',
    recommended: false,
    notes: '58mm arzon.',
  },
  {
    key: 'bixolon_srp350iii',
    brand: 'Bixolon',
    model: 'SRP-350III',
    paper_width_mm: 80,
    has_cutter: true,
    encoding: 'CP1251',
    recommended_connection: 'lan',
    usb_vendor_id: '1504',
    usb_product_id: '0006',
    recommended: false,
    notes: 'Sifatli, kamroq topiladi.',
  },
  {
    key: 'goojprt_pt210',
    brand: 'Goojprt',
    model: 'PT-210',
    paper_width_mm: 58,
    has_cutter: false,
    encoding: 'CP1251',
    recommended_connection: 'bluetooth',
    recommended: false,
    notes: "Bluetooth, ko'chma — injiqroq.",
  },
  {
    key: 'universal_80',
    brand: 'Boshqa',
    model: 'Universal 80mm ESC/POS',
    paper_width_mm: 80,
    has_cutter: false,
    encoding: 'CP1251',
    recommended_connection: 'lan',
    recommended: false,
    notes: "Ro'yxatda yo'q bo'lsa — qo'lda sozlash.",
  },
];

export const getPresetByKey = (key: string) =>
  PRINTER_PRESETS.find((p) => p.key === key);
