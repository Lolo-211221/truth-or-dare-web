import type { CSSProperties } from 'react';
import QRCode from 'react-qr-code';

type QRProps = {
  value: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
  style?: CSSProperties;
};

/**
 * Room join QR — uses package default export (reliable under Vite ESM).
 * Value should be the full room URL (e.g. origin + /room/CODE).
 */
export function QrCode(props: QRProps) {
  if (!props.value?.trim()) return null;
  return <QRCode {...props} />;
}
