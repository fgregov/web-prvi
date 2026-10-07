// Lucide icons (ISC licence) as DOM SVG, matching the dashboard's inline sprite.
const SVG = 'http://www.w3.org/2000/svg';

const ICONS = {
  plus: [['path', 'M5 12h14M12 5v14']],
  x: [['path', 'M18 6 6 18M6 6l12 12']],
  'arrow-left': [['path', 'm12 19-7-7 7-7M19 12H5']],
  'chevron-right': [['path', 'm9 18 6-6-6-6']],
  'chevron-left': [['path', 'm15 18-6-6 6-6']],
  'chevron-down': [['path', 'm6 9 6 6 6-6']],
  'arrow-up': [['path', 'M12 19V5M5 12l7-7 7 7']],
  'arrow-down': [['path', 'M12 5v14M19 12l-7 7-7-7']],
  home: [
    [
      'path',
      'M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2h-4v-7a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v7H5a2 2 0 0 1-2-2z',
    ],
  ],
  users: [
    ['path', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['path', 'M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'],
  ],
  repeat: [
    ['path', 'm17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3'],
  ],
  bars: [['path', 'M3 3v18h18M18 17V9M13 17V5M8 17v-3']],
  ellipsis: [
    ['circle', { cx: 12, cy: 12, r: 1 }],
    ['circle', { cx: 19, cy: 12, r: 1 }],
    ['circle', { cx: 5, cy: 12, r: 1 }],
  ],
  history: [
    ['path', 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'],
    ['path', 'M3 3v5h5M12 7v5l4 2'],
  ],
  file: [
    ['path', 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z'],
    ['path', 'M14 2v4a2 2 0 0 0 2 2h4M10 13h4M10 17h4'],
  ],
  circle: [['circle', { cx: 12, cy: 12, r: 9 }]],
  calendar: [
    ['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }],
    ['path', 'M16 2v4M8 2v4M3 10h18'],
  ],
  target: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['circle', { cx: 12, cy: 12, r: 6 }],
    ['circle', { cx: 12, cy: 12, r: 2 }],
  ],
  'check-square': [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    ['path', 'm9 12 2 2 4-4'],
  ],
  check: [['path', 'M20 6 9 17l-5-5']],
  note: [
    ['path', 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'],
    ['path', 'M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8'],
  ],
  'user-plus': [
    ['path', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['path', 'M19 8v6M22 11h-6'],
  ],
  user: [
    ['path', 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'],
    ['circle', { cx: 12, cy: 7, r: 4 }],
  ],
  mail: [
    ['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }],
    ['path', 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'],
  ],
  pencil: [
    [
      'path',
      'M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z',
    ],
    ['path', 'm15 5 4 4'],
  ],
  building: [
    ['path', 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z'],
    [
      'path',
      'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4',
    ],
  ],
  phone: [
    [
      'path',
      'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
    ],
  ],
  'map-pin': [
    [
      'path',
      'M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0',
    ],
    ['circle', { cx: 12, cy: 10, r: 3 }],
  ],
  video: [
    ['path', 'm16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5'],
    ['rect', { x: 2, y: 6, width: 14, height: 12, rx: 2 }],
  ],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', 'M12 6v6l4 2'],
  ],
  globe: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20'],
  ],
  alert: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', 'M12 8v4M12 16h.01'],
  ],
  info: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', 'M12 16v-4M12 8h.01'],
  ],
};

export function icon(name, className = 'rv-icon') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  for (const [tag, attrs] of ICONS[name] ?? []) {
    const node = document.createElementNS(SVG, tag);
    if (typeof attrs === 'string') node.setAttribute('d', attrs);
    else for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.append(node);
  }
  return svg;
}
