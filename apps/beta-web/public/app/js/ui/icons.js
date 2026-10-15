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
  bell: [
    ['path', 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9'],
    ['path', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  ],
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
  'user-search': [
    ['circle', { cx: 10, cy: 7, r: 4 }],
    ['path', 'M10.3 15H7a4 4 0 0 0-4 4v2'],
    ['circle', { cx: 17, cy: 17, r: 3 }],
    ['path', 'm21 21-1.9-1.9'],
  ],
  'user-check': [
    ['path', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['path', 'm16 11 2 2 4-4'],
  ],
  'circle-x': [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', 'm15 9-6 6M9 9l6 6'],
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
  link: [
    ['path', 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'],
    ['path', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
  ],
  copy: [
    ['rect', { x: 8, y: 8, width: 14, height: 14, rx: 2 }],
    ['path', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'],
  ],
  eye: [
    [
      'path',
      'M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0',
    ],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  upload: [['path', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12']],
  send: [
    [
      'path',
      'M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.03.94l7.93 3.18a2 2 0 0 1 1.11 1.11z',
    ],
    ['path', 'm21.85 2.15-10.94 10.94'],
  ],
  ban: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', 'm4.9 4.9 14.2 14.2'],
  ],
  'briefcase-business': [
    ['path', 'M12 12h.01M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M22 13a18.15 18.15 0 0 1-20 0'],
    ['rect', { width: 20, height: 14, x: 2, y: 6, rx: 2 }],
  ],
  'chart-column': [['path', 'M3 3v16a2 2 0 0 0 2 2h16M18 17V9M13 17V5M8 17v-3']],
  'layout-grid': [
    ['rect', { width: 7, height: 7, x: 3, y: 3, rx: 1 }],
    ['rect', { width: 7, height: 7, x: 14, y: 3, rx: 1 }],
    ['rect', { width: 7, height: 7, x: 14, y: 14, rx: 1 }],
    ['rect', { width: 7, height: 7, x: 3, y: 14, rx: 1 }],
  ],
  kanban: [
    ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
    ['path', 'M8 7v7M12 7v4M16 7v9'],
  ],
  'message-square': [['path', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z']],
  settings: [
    [
      'path',
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    ],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  'log-out': [['path', 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9']],
  menu: [['path', 'M4 6h16M4 12h16M4 18h16']],
  'panel-left-close': [
    ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
    ['path', 'M9 3v18M16 15l-3-3 3-3'],
  ],
  'panel-left-open': [
    ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
    ['path', 'M9 3v18M14 9l3 3-3 3'],
  ],
  search: [
    ['circle', { cx: 11, cy: 11, r: 8 }],
    ['path', 'm21 21-4.3-4.3'],
  ],
  lock: [
    ['rect', { width: 18, height: 11, x: 3, y: 11, rx: 2 }],
    ['path', 'M7 11V7a5 5 0 0 1 10 0v4'],
  ],
  shield: [
    [
      'path',
      'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    ],
  ],
  'user-x': [
    ['path', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['path', 'm17 8 5 5M22 8l-5 5'],
  ],
  'eye-off': [
    [
      'path',
      'M10.73 5.08a10.74 10.74 0 0 1 11.2 6.57 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49M14.08 14.16a3 3 0 0 1-4.24-4.24M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14M2 2l20 20',
    ],
  ],
  'arrow-up-down': [['path', 'm21 16-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16']],
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
