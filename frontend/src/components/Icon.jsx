const P = {
  moon: <path className="ic" d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  list: <path className="ic" d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  chart: <path className="ic" d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  gear: <><circle className="ic" cx="12" cy="12" r="3" /><path className="ic" d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  plus: <path className="ic" d="M12 5v14M5 12h14" />,
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
