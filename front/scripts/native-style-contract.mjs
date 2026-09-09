function attributeValue(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ?? null;
}

function requiredRule(stylesheetCss, selector, declarations) {
  const match = Array.from(stylesheetCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)).find((rule) =>
    rule[1].split(',').some((candidate) => candidate.trim() === selector),
  );
  if (!match) {
    throw new Error(`El CSS nativo no contiene la regla estructural ${selector}.`);
  }

  for (const [property, value] of declarations) {
    const declaration = new RegExp(`(?:^|;)${property}:${value}(?:;|$)`, 'i');
    if (!declaration.test(match[2])) {
      throw new Error(
        `La regla ${selector} no contiene ${property}: ${value}, requerido por Ionic.`,
      );
    }
  }
}

export function validateNativeStyleDelivery(indexHtml, stylesheetCss) {
  const links = indexHtml.match(/<link\b[^>]*>/gi) ?? [];
  const stylesLink = links.find((tag) => {
    const rel = attributeValue(tag, 'rel')?.toLowerCase().split(/\s+/) ?? [];
    const href = attributeValue(tag, 'href') ?? '';
    return rel.includes('stylesheet') && /(?:^|\/)styles(?:-[^/]+)?\.css(?:[?#].*)?$/i.test(href);
  });

  if (!stylesLink) {
    throw new Error('El index nativo no carga el bundle global styles*.css.');
  }

  const media = attributeValue(stylesLink, 'media');
  if (media && media.toLowerCase() !== 'all') {
    throw new Error(
      `El bundle global nativo queda condicionado por media=${JSON.stringify(media)}.`,
    );
  }
  if (/\bonload\s*=/i.test(stylesLink)) {
    throw new Error(
      'El bundle global nativo depende de un onload inline incompatible con script-src self.',
    );
  }

  requiredRule(stylesheetCss, '.ion-page', [
    ['display', 'flex'],
    ['position', 'absolute'],
  ]);
  requiredRule(stylesheetCss, '.ion-page-hidden', [['display', 'none!important']]);

  return { stylesheetHref: attributeValue(stylesLink, 'href') };
}
