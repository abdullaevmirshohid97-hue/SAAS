const UZ_CYR_TO_LAT: Record<string, string> = {
  \u0430:'a', \u0431:'b', \u0432:'v', \u0433:'g', \u0493:'g', \u0434:'d', \u0435:'e', \u0451:'yo',
  \u0436:'j', \u0437:'z', \u0438:'i', \u0439:'y', \u043A:'k', \u049B:'q', \u043B:'l', \u043C:'m',
  \u043D:'n', \u043E:'o', \u045E:'o', \u04E9:'o', \u043F:'p', \u0440:'r', \u0441:'s', \u0442:'t',
  \u0443:'u', \u04B3:'h', \u0444:'f', \u0445:'x', \u0446:'ts', \u0447:'ch', \u0448:'sh', \u0449:'shch',
  \u044A:'', \u044B:'y', \u044C:'', \u044D:'e', \u044E:'yu', \u044F:'ya'
};

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .split('')
    .map((ch) => UZ_CYR_TO_LAT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
