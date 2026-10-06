import { describe, expect, it } from 'vitest';

import {
  cleanForm,
  fromElastic,
  fromWebKatalog,
  kindForMxik,
  mapMxikRow,
  parseAtc,
  parseGtins,
  parsePack,
  packageQty,
  parsePackages,
  parseStrength,
  pickPackageCode,
  splitBrand,
  subPositionName,
  unitNameFromUnits,
} from './drug-reference';

// Haqiqiy tasnif.soliq.uz javoblaridan olingan namunalar (lang=ru)
const WEB = {
  mxikCode: '03004002005005001',
  brand: '03004002005005-М-ГИЛ (Avantika Medex Pvt Ltd)',
  attribute: 'Таблетки покрытые пленочной оболочкой 250мг блистеры №20(2x10)',
  subPosition: '03004002005-Метронидазол - A01AB17',
  position: '03004002-Противомикробные препараты (Стоматологические препараты) -A01AB',
  units: 'шт (таблетка (250 мг)) ',
  packageName: 'упаковка * 2 блистер ( 10 дона (таблетка (250 мг)) ',
  mnnName: 'метронидазол',
  lgotaName: '(ст.243 НК) пункт 13. лекарственных средств',
  internationalCode: '4780086540633',
};

describe('splitBrand', () => {
  it('oxirgi qavs — ishlab chiqaruvchi', () => {
    expect(splitBrand('03004002005005-М-ГИЛ (Avantika Medex Pvt Ltd)')).toEqual({
      name: 'М-ГИЛ',
      manufacturer: 'Avantika Medex Pvt Ltd',
    });
    expect(
      splitBrand('03004072001003-ВИТАМИН В1 (ТИАМИН ГИДРОХЛОРИД) (Jurabek Laboratories)'),
    ).toEqual({ name: 'ВИТАМИН В1 (ТИАМИН ГИДРОХЛОРИД)', manufacturer: 'Jurabek Laboratories' });
  });
  it('qavssiz brend va "---"', () => {
    expect(splitBrand('03005001001003-BAXTTEKS-FARM')).toEqual({
      name: 'BAXTTEKS-FARM',
      manufacturer: null,
    });
    expect(splitBrand('09018001006000 ---').name).toBe('');
  });
  it('elasticsearch brendi (kodsiz), raqam bilan boshlanuvchi nom saqlanadi', () => {
    expect(splitBrand('ОНДАЛЕК (Лекхим-Харьков)')).toEqual({
      name: 'ОНДАЛЕК',
      manufacturer: 'Лекхим-Харьков',
    });
    expect(splitBrand('911 (Твинс Тэк)').name).toBe('911');
  });
  it('qavs ichida qavs', () => {
    expect(
      splitBrand('Уницем (АО "Опытно-эксперименнтальный завод "ВладМиВа", Россия)').manufacturer,
    ).toBe('АО "Опытно-эксперименнтальный завод "ВладМиВа", Россия');
  });
});

describe('parseAtc / subPositionName', () => {
  it('ATX subpozitsiyadan, bo‘lmasa pozitsiyadan', () => {
    expect(parseAtc('03004002005-Метронидазол - A01AB17')).toBe('A01AB17');
    expect(parseAtc('03004008004-A02AF02')).toBe('A02AF02');
    expect(parseAtc('Парацетамол в комбинации - n02be51')).toBe('N02BE51');
    expect(parseAtc('03005001001-Вата медицинская', '03005001-Вата -N02BE')).toBe('N02BE');
    expect(parseAtc('03005001001-Вата медицинская')).toBeNull();
  });
  it('subpozitsiya nomi kod va ATXsiz', () => {
    expect(subPositionName('03004002005-Метронидазол - A01AB17')).toBe('Метронидазол');
    expect(subPositionName('03005001001-Вата медицинская')).toBe('Вата медицинская');
    expect(subPositionName('03004008004-A02AF02')).toBeNull();
  });
});

describe('parseStrength / cleanForm', () => {
  it('birinchi miqdor', () => {
    expect(parseStrength('Таблетки 10 мг блистеры №100(10x10)')).toBe('10 мг');
    expect(parseStrength('Раствор для инъекций 2 мг/мл 4 ампулы №5(1x5)')).toBe('2 мг/мл');
    expect(parseStrength('Раствор для инъекций 8 мг/4 мл 4мл ампулы')).toBe('8 мг/4 мл');
    expect(parseStrength('Раствор для инфузий 6 % 100мл флаконы')).toBe('6 %');
    expect(parseStrength('таблетки 1000 МЕ №50')).toBe('1000 МЕ');
    // "ME" lotin harflarida (MXIK'da uchraydi)
    expect(parseStrength('капсулы мягкие 20,000 ME')).toBe('20,000 ME');
    expect(parseStrength('С витамином с таблетки шипучие тубы №10(1x10)')).toBeNull();
    expect(parseStrength('Пакет 20 гр')).toBeNull();
  });
  it('shakli: dozasi va №… olib tashlanadi', () => {
    expect(
      cleanForm('Таблетки покрытые пленочной оболочкой 250мг блистеры №20(2x10)', '250мг'),
    ).toBe('Таблетки покрытые пленочной оболочкой блистеры');
    expect(cleanForm('Гель для десен 20г тубы', '20г')).toBe('Гель для десен тубы');
  });
});

describe('parsePack', () => {
  it('qadoq nomidan', () => {
    expect(parsePack('', 'упаковка * 2 блистер ( 10 дона (таблетка (250 мг)) ')).toEqual({
      pack_qty: 20,
      blister_qty: 10,
    });
    expect(parsePack('', 'упаковка * 5 блистер * 10 дона (капсула (250 мг))')).toEqual({
      pack_qty: 50,
      blister_qty: 10,
    });
    expect(parsePack('', 'упаковка * 1 блистер ( 10 дона (таблетка) ')).toEqual({
      pack_qty: 10,
      blister_qty: null,
    });
    expect(parsePack('', 'упаковка * 20 дона (пакетча (30 мл)) ')).toEqual({
      pack_qty: 20,
      blister_qty: null,
    });
    expect(parsePack('', 'упаковка * 5 шт. (ампула) ').pack_qty).toBe(5);
  });
  it('atributdan', () => {
    expect(parsePack('Капсулы 250 мг упаковки контурные ячейковые №50(5x10)')).toEqual({
      pack_qty: 50,
      blister_qty: 10,
    });
    expect(parsePack('Раствор для инъекций 2мл ампулы №10(1x10)')).toEqual({
      pack_qty: 10,
      blister_qty: null,
    });
    expect(parsePack('раствор для инъекций 2 мл N5').pack_qty).toBe(5);
    expect(parsePack('Раствор для инфузий 250мл флаконы')).toEqual({
      pack_qty: 1,
      blister_qty: null,
    });
    expect(parsePack('Растительное сырье 25 г', 'мешок * 25 килограмм').pack_qty).toBe(1);
  });
});

describe('unitNameFromUnits / parseGtins', () => {
  it('birlik', () => {
    expect(unitNameFromUnits('шт (таблетка (250 мг)) ')).toBe('tabletka');
    expect(unitNameFromUnits('шт. (ампула 2 мл) ')).toBe('ampula');
    expect(unitNameFromUnits('шт (пакетик (30 мл)) ')).toBe('paket');
    expect(unitNameFromUnits('шт.')).toBeNull();
  });
  it('faqat to‘g‘ri GTIN, 14 xonaga', () => {
    expect(parseGtins('4780086540633')).toEqual(['04780086540633']);
    expect(parseGtins('4780086540634')).toEqual([]);
    expect(parseGtins('')).toEqual([]);
  });
});

describe('mapMxikRow', () => {
  it('dori (web-katalog)', () => {
    const r = mapMxikRow(fromWebKatalog(WEB));
    expect(r).toMatchObject({
      mxik_code: '03004002005005001',
      kind: 'drug',
      name: 'М-ГИЛ',
      manufacturer: 'Avantika Medex Pvt Ltd',
      strength: '250мг',
      form: 'Таблетки покрытые пленочной оболочкой блистеры',
      pack_qty: 20,
      blister_qty: 10,
      unit_name: 'tabletka',
      generic_name: 'метронидазол',
      atc_code: 'A01AB17',
      class_code: '03004',
      subposition_name: 'Метронидазол',
      vat_exempt: true,
      gtins: ['04780086540633'],
    });
  });
  it('MNN yo‘q — null; QQS imtiyozi yo‘q — false', () => {
    const r = mapMxikRow(
      fromWebKatalog({ ...WEB, mnnName: 'Отсутствует утверждённое МНН', lgotaName: '' }),
    );
    expect(r?.generic_name).toBeNull();
    expect(r?.vat_exempt).toBe(false);
  });
  it('tibbiy buyum: "---" brend — nomi atributdan', () => {
    const r = mapMxikRow(
      fromWebKatalog({
        mxikCode: '09018001006000001',
        brand: '09018001006000 ---',
        attribute: 'Зонд хирургический желобоватый',
        subPosition: '09018001006-Зонды и прочие эндоскопы',
        units: 'шт.',
      }),
    );
    expect(r).toMatchObject({
      kind: 'device',
      name: 'Зонд хирургический желобоватый',
      manufacturer: null,
      form: null,
      pack_qty: 1,
    });
  });
  it('BAD: brend + atribut', () => {
    const r = mapMxikRow(
      fromWebKatalog({
        mxikCode: '02106999028002002',
        brand: '02106999028002-Lik',
        attribute: 'Stell Ferrum в капсулах 0,85 г',
        subPosition: '02106999028-Биологически активные добавки к пище',
      }),
    );
    expect(r).toMatchObject({ kind: 'bad', name: 'Lik Stell Ferrum в капсулах 0,85 г' });
  });
  it('sinf kodi ("---" / "---") — mahsulot emas', () => {
    expect(
      mapMxikRow(
        fromWebKatalog({
          mxikCode: '09018001006000000',
          brand: '09018001006000 ---',
          attribute: '---',
        }),
      ),
    ).toBeNull();
    expect(mapMxikRow(fromWebKatalog({ ...WEB, mxikCode: '123' }))).toBeNull();
  });
  it('elasticsearch javobi (jonli shtrix-kod so‘rovi)', () => {
    const r = mapMxikRow(
      fromElastic({
        mxikCode: '03004026001006002',
        classCode: '03004',
        brandName: 'ОНДАЛЕК (Лекхим-Харьков)',
        attributeName: 'Раствор для инъекций 2 мг/мл 4 ампулы №5(1x5)',
        subPositionName: 'Ондансетрон - A04AA01',
        positionName: 'Антагонисты серотониновых 5ht3 \nрецепторов-A04AA',
        unitsName: 'шт (ампула (2 мг/мл 4)) ',
        packageName: 'упаковка * 5 дона (ампула (2 мг/мл 4)) ',
        mnnName: 'ондансетрон',
        lgotaName: '(ст.243 НК) пункт 13.',
        internationalCode: '4820014492228',
      }),
    );
    expect(r).toMatchObject({
      name: 'ОНДАЛЕК',
      manufacturer: 'Лекхим-Харьков',
      strength: '2 мг/мл',
      pack_qty: 5,
      unit_name: 'ampula',
      atc_code: 'A04AA01',
      gtins: ['04820014492228'],
    });
  });
});

describe('kindForMxik', () => {
  it('sinf va subpozitsiya bo‘yicha', () => {
    expect(kindForMxik('03004002005005001')).toBe('drug');
    expect(kindForMxik('02106999028002002')).toBe('bad');
    expect(kindForMxik('02106999018001001')).toBe('other');
    expect(kindForMxik('09018001006000001')).toBe('device');
    expect(kindForMxik('03305001001001001')).toBe('other');
  });
});

describe('qadoq kodlari', () => {
  it('blisterli qadoq — blister × dona (haqiqiy MXIK javobi)', () => {
    const list = parsePackages([
      { code: 1124222, nameRu: 'шт (капсула (20 мг))' },
      { code: 1129252, nameRu: 'блистер=10 шт (капсула (20 мг))' },
      { code: 1131950, nameRu: 'упаковка=2 блистер (10 шт (капсула (20 мг))' },
    ]);
    expect(list.map((p) => p.qty)).toEqual([1, 10, 20]);
    expect(pickPackageCode(list, 20, false)).toBe('1131950');
    expect(packageQty('қадоқ=2 блистер (10 дона (таблетка))')).toBe(20);
    expect(packageQty('қадоқ=10 дона (пакетча)')).toBe(10);
  });

  const pk = parsePackages([
    { code: 1164638, nameRu: 'шт (ампула (2 мг/мл 2))', packageType: '1' },
    { code: 1165125, nameRu: 'упаковка=5 шт (ампула (2 мг/мл 2))', packageType: '1' },
  ]);
  it('nom va son', () => {
    expect(pk).toEqual([
      { code: '1164638', name: 'шт (ампула (2 мг/мл 2))', qty: 1 },
      { code: '1165125', name: 'упаковка=5 шт (ампула (2 мг/мл 2))', qty: 5 },
    ]);
    expect(parsePackages(null)).toEqual([]);
  });
  it('sotuv birligiga mos kod', () => {
    expect(pickPackageCode(pk, 5, false)).toBe('1165125');
    expect(pickPackageCode(pk, 5, true)).toBe('1164638');
    expect(pickPackageCode(pk, 1, false)).toBe('1164638');
    expect(pickPackageCode(pk, 20, false)).toBe('1164638');
    expect(pickPackageCode([], 5, false)).toBeNull();
  });
});
