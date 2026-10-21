const P = {
  moon: <path className="ic" d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  list: <path className="ic" d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  chart: <path className="ic" d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  gear: <><path className="ic" d="M19.21 9.29 L21.84 10.21 L21.84 13.79 L19.21 14.71 A7.7 7.7 0 0 1 19.01 15.18 L19.01 15.18 L20.22 17.69 L17.69 20.22 L15.18 19.01 A7.7 7.7 0 0 1 14.71 19.21 L14.71 19.21 L13.79 21.84 L10.21 21.84 L9.29 19.21 A7.7 7.7 0 0 1 8.82 19.01 L8.82 19.01 L6.31 20.22 L3.78 17.69 L4.99 15.18 A7.7 7.7 0 0 1 4.79 14.71 L4.79 14.71 L2.16 13.79 L2.16 10.21 L4.79 9.29 A7.7 7.7 0 0 1 4.99 8.82 L4.99 8.82 L3.78 6.31 L6.31 3.78 L8.82 4.99 A7.7 7.7 0 0 1 9.29 4.79 L9.29 4.79 L10.21 2.16 L13.79 2.16 L14.71 4.79 A7.7 7.7 0 0 1 15.18 4.99 L15.18 4.99 L17.69 3.78 L20.22 6.31 L19.01 8.82 Z" /><circle className="ic" cx="12" cy="12" r="3" /></>,   // a cogwheel (the rays read as a sun)
  plus: <path className="ic" d="M12 5v14M5 12h14" />,
  play: <path d="M8 5.5v13l11-6.5Z" fill="currentColor" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />,
  wave: <path className="ic" d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2" />,
  alarm: <><circle className="ic" cx="12" cy="13" r="7.5" /><path className="ic" d="M12 9v4l2.5 2M4.5 4.5 7 2.5M19.5 4.5 17 2.5" /></>,
  sparkle: <path className="ic" d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9ZM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" />,
  music: <><path className="ic" d="M9 18V6l10-2v12" /><circle className="ic" cx="6.5" cy="18" r="2.5" /><circle className="ic" cx="16.5" cy="16" r="2.5" /></>,
  bell: <path className="ic" d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15ZM10 20.5a2 2 0 0 0 4 0" />,
  person: <><circle className="ic" cx="12" cy="8.5" r="3.5" /><path className="ic" d="M5 20c1-3.5 3.8-5.5 7-5.5s6 2 7 5.5" /></>,
  close: <path className="ic" d="M6 6l12 12M18 6 6 18" />,
  sun: <><circle className="ic" cx="12" cy="12" r="4" /><path className="ic" d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  back: <path className="ic" d="M15 5l-7 7 7 7" />,
  chev: <path className="ic" d="M9 5l7 7-7 7" />,
  mic: <><rect className="ic" x="9" y="3" width="6" height="11" rx="3" /><path className="ic" d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  check: <path className="ic" d="M5 12.5l4.5 4.5L19 7.5" />,
  edit: <path className="ic" d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />,
  trash: <path className="ic" d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
}
export const Icon = ({ name, ...p }) => <svg viewBox="0 0 24 24" aria-hidden="true" {...p}>{P[name]}</svg>
