import type { ComponentType, CSSProperties } from 'react';
import * as QRMod from 'react-qr-code';

type QRProps = {
  value: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
  style?: CSSProperties;
};

/**
 * Vite + CJS interop: `import QRCode from 'react-qr-code'` can resolve to the
 * module namespace object, causing React #130 (invalid element type: object).
 */
function getQrComponent(): ComponentType<QRProps> | null {
  const mod = QRMod as unknown as Record<string, unknown>;
  const d = mod.default;
  if (typeof d === 'function') return d as ComponentType<QRProps>;
  if (d && typeof d === 'object' && 'default' in (d as object)) {
    const inner = (d as { default?: unknown }).default;
    if (typeof inner === 'function') return inner as ComponentType<QRProps>;
  }
  return null;
}

const QrResolved = getQrComponent();

export function QrCode(props: QRProps) {
  if (!QrResolved) return null;
  return <QrResolved {...props} />;
}
