// Icons from the Home page's own SVG sprite (prototypes/home/index.html), so
// widgets rendered from data look exactly like the static ones.
const SVG = 'http://www.w3.org/2000/svg';

export function spriteIcon(name, className = 'icon') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
